// Render the soft marketing backdrop in the existing WebGL context, avoiding a
// CSS filter on the scrolling layer. The product uses the unblurred renderer.
export async function createHeroCanvasBlur(
	gl: WebGL2RenderingContext,
	canvas: HTMLCanvasElement,
	surface: HTMLElement,
	signal: AbortSignal,
) {
	const highPrecision = !!(
		gl.getExtension("EXT_color_buffer_float") ||
		gl.getExtension("EXT_color_buffer_half_float")
	);
	const originalProgram: WebGLProgram | null = gl.getParameter(
		gl.CURRENT_PROGRAM,
	);
	const originalVao: WebGLVertexArrayObject | null = gl.getParameter(
		gl.VERTEX_ARRAY_BINDING,
	);
	const vertexSource = `#version 300 es
 void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
	const fragmentSource = `#version 300 es
 precision highp float;
 uniform sampler2D source;
 uniform vec2 sourceSize, outputSize, direction, shapeSize;
 uniform float radius;
 uniform bool clipSource, presentOnly, ditherOutput;
 uniform vec2 taps[9];
 out vec4 color;
 vec4 sampleColor(vec2 uv){
  vec4 value=texture(source,uv);
  if(clipSource){
   vec2 q=abs(uv*sourceSize-sourceSize*.5)-shapeSize*.5+radius;
   float distance=length(max(q,0.0))+min(max(q.x,q.y),0.0)-radius;
   float coverage=1.0-smoothstep(-.5,.5,distance);
   // Original alpha:false canvas blends the palette over white; that RGB is opaque.
   value=vec4(value.rgb,1.0)*coverage;
  }
  return value;
 }
 void main(){
  vec2 uv=gl_FragCoord.xy/outputSize;
  vec4 sum;
  if(presentOnly){
   sum=texture(source,uv);
  }else{
   sum=sampleColor(uv)*taps[0].y;
   for(int i=1;i<9;i++){
    vec2 offset=direction*taps[i].x/sourceSize;
    sum+=(sampleColor(uv+offset)+sampleColor(uv-offset))*taps[i].y;
   }
  }
  if(ditherOutput){
   // Fixed per output pixel: sub-LSB noise breaks quantization contours without shimmer.
   uvec2 pixel=uvec2(gl_FragCoord.xy);
   uint hash=pixel.x+pixel.y*65537u;
   hash^=hash>>16;hash*=0x7feb352du;hash^=hash>>15;hash*=0x846ca68bu;hash^=hash>>16;
   float noise=(float(hash&65535u)/65536.0-.5)/255.0;
   // Correlate RGB/alpha rounding to retain the white-backed premultiplied gradient.
   sum=clamp(sum+vec4(noise),0.0,1.0);
   sum.rgb=min(sum.rgb,vec3(sum.a));
  }
  color=sum;
 }`;
	const compile = (type: number, source: string) => {
		const shader = gl.createShader(type);
		if (!shader) throw new Error("Could not create blur shader");
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		return shader;
	};
	const vertex = compile(gl.VERTEX_SHADER, vertexSource);
	const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
	const program = gl.createProgram();
	if (!program) throw new Error("Could not create blur program");
	gl.attachShader(program, vertex);
	gl.attachShader(program, fragment);
	gl.linkProgram(program);
	const parallel = gl.getExtension("KHR_parallel_shader_compile");
	while (
		!signal.aborted &&
		parallel &&
		!gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)
	) {
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
	}
	if (signal.aborted || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const message =
			gl.getProgramInfoLog(program) ?? "Could not link blur program";
		gl.deleteProgram(program);
		gl.deleteShader(vertex);
		gl.deleteShader(fragment);
		if (signal.aborted) return null;
		throw new Error(message);
	}
	const uniform = Object.fromEntries(
		[
			"source",
			"sourceSize",
			"outputSize",
			"direction",
			"shapeSize",
			"radius",
			"clipSource",
			"presentOnly",
			"ditherOutput",
			"taps[0]",
		].map((name) => [name, gl.getUniformLocation(program, name)]),
	);
	const quad = gl.createVertexArray();
	const textures = [gl.createTexture(), gl.createTexture()];
	const framebuffers = [gl.createFramebuffer(), gl.createFramebuffer()];
	const depth = gl.createRenderbuffer();
	if (
		!quad ||
		!depth ||
		textures.some((value) => !value) ||
		framebuffers.some((value) => !value)
	)
		throw new Error("Could not allocate blur resources");
	// Sigma = 5 low-resolution texels; combine adjacent Gaussian taps with bilinear sampling.
	const gaussian = Array.from({ length: 17 }, (_, i) =>
		i <= 15 ? Math.exp((-i * i) / 50) : 0,
	);
	const total =
		gaussian[0] +
		2 * gaussian.slice(1).reduce((sum, weight) => sum + weight, 0);
	const taps = new Float32Array(18);
	taps[1] = gaussian[0] / total;
	for (let i = 1; i < 9; i++) {
		const first = 2 * i - 1,
			weight = gaussian[first] + gaussian[first + 1];
		taps[2 * i] = first + gaussian[first + 1] / weight;
		taps[2 * i + 1] = weight / total;
	}
	let width = 0,
		height = 0,
		shapeWidth = 0,
		shapeHeight = 0,
		shapeRadius = 0;
	let bounds = { width: 0, height: 0 };
	let ratio = 0.75;
	let measuredWidth = -1,
		measuredHeight = -1;
	const measure = () => {
		if (
			measuredWidth === surface.clientWidth &&
			measuredHeight === surface.clientHeight
		)
			return;
		measuredWidth = surface.clientWidth;
		measuredHeight = surface.clientHeight;
		const style = getComputedStyle(surface);
		const sigma = Number(style.getPropertyValue("--canvas-blur-radius"));
		const sourceRatio = 5 / sigma;
		ratio = Math.min(1.5, devicePixelRatio || 1, sourceRatio * 5);
		bounds = { width: measuredWidth, height: measuredHeight };
		shapeWidth = Math.max(1, Math.round(bounds.width * sourceRatio));
		shapeHeight = Math.max(1, Math.round(bounds.height * sourceRatio));
		shapeRadius = Math.min(
			Number(style.getPropertyValue("--canvas-shape-radius")) * sourceRatio,
			shapeWidth / 2,
			shapeHeight / 2,
		);
		const nextWidth = shapeWidth + 30,
			nextHeight = shapeHeight + 30;
		if (nextWidth === width && nextHeight === height) return;
		width = nextWidth;
		height = nextHeight;
		gl.activeTexture(gl.TEXTURE0);
		for (let index = 0; index < 2; index++) {
			gl.bindTexture(gl.TEXTURE_2D, textures[index]);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				highPrecision ? gl.RGBA16F : gl.RGBA,
				width,
				height,
				0,
				gl.RGBA,
				highPrecision ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
				null,
			);
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[index]);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				textures[index],
				0,
			);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0]);
		gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
		gl.renderbufferStorage(
			gl.RENDERBUFFER,
			gl.DEPTH_COMPONENT16,
			width,
			height,
		);
		gl.framebufferRenderbuffer(
			gl.FRAMEBUFFER,
			gl.DEPTH_ATTACHMENT,
			gl.RENDERBUFFER,
			depth,
		);
		// Check only after the attached depth buffer has caught up with the resized colors.
		for (const framebuffer of framebuffers) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
			if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
				throw new Error("Incomplete blur framebuffer");
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	};
	measure();
	return {
		bounds() {
			measure();
			return bounds;
		},
		pixelRatio() {
			return ratio;
		},
		begin() {
			gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers[0]);
			gl.viewport(15, 15, shapeWidth, shapeHeight);
		},
		end() {
			gl.disable(gl.BLEND);
			gl.disable(gl.DEPTH_TEST);
			gl.disable(gl.CULL_FACE);
			gl.bindVertexArray(quad);
			// biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook.
			gl.useProgram(program);
			gl.activeTexture(gl.TEXTURE0);
			gl.uniform1i(uniform.source, 0);
			gl.uniform2f(uniform.sourceSize, width, height);
			gl.uniform2f(uniform.shapeSize, shapeWidth, shapeHeight);
			gl.uniform1f(uniform.radius, shapeRadius);
			gl.uniform2fv(uniform["taps[0]"], taps);
			const passes = 3;
			for (let pass = 0; pass < passes; pass++) {
				const finalPass = pass === passes - 1;
				const outputWidth = finalPass ? canvas.width : width;
				const outputHeight = finalPass ? canvas.height : height;
				// Both blur passes stay small; the third only upsamples/dithers.
				gl.bindFramebuffer(
					gl.FRAMEBUFFER,
					finalPass ? null : framebuffers[(pass + 1) % 2],
				);
				gl.bindTexture(gl.TEXTURE_2D, textures[pass % 2]);
				gl.viewport(0, 0, outputWidth, outputHeight);
				gl.uniform2f(uniform.outputSize, outputWidth, outputHeight);
				gl.uniform2f(uniform.direction, pass === 0 ? 1 : 0, pass === 0 ? 0 : 1);
				gl.uniform1i(uniform.clipSource, pass === 0 ? 1 : 0);
				gl.uniform1i(uniform.presentOnly, finalPass ? 1 : 0);
				gl.uniform1i(uniform.ditherOutput, finalPass || !highPrecision ? 1 : 0);
				gl.drawArrays(gl.TRIANGLES, 0, 3);
			}
			gl.bindVertexArray(originalVao);
			// biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook.
			gl.useProgram(originalProgram);
			gl.enable(gl.BLEND);
			gl.enable(gl.DEPTH_TEST);
			gl.enable(gl.CULL_FACE);
		},
		dispose() {
			for (const texture of textures) gl.deleteTexture(texture);
			for (const framebuffer of framebuffers) gl.deleteFramebuffer(framebuffer);
			gl.deleteRenderbuffer(depth);
			gl.deleteVertexArray(quad);
			gl.deleteProgram(program);
			gl.deleteShader(vertex);
			gl.deleteShader(fragment);
		},
	};
}
