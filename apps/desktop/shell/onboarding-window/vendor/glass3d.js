(()=>{var uQ="187";var cQ=0,D1=1,nQ=2;var q0=1,sQ=2,P9=3,w9=0,f6=1,m6=2,a7=0,K0=1,O1=2,R1=3,M1=4,iQ=5;var T9=100,oQ=101,aQ=102,rQ=103,tQ=104,eQ=200,J$=201,Q$=202,$$=203,Z$=204,W$=205,q$=206,K$=207,H$=208,U$=209,Y$=210,X$=211,G$=212,N$=213,E$=214,F$=0,D$=1,O$=2,k1=3,R$=4,M$=5,k$=6,L$=7,B$=0,z$=1,V$=2,X7=0,L1=1,B1=2,z1=3,H0=4,V1=5,I1=6,A1=7;var U0=301,S9=302,r0=303,t0=304,e0=1000,j9=1001,J5=1002,e6=1003,I$=1004;var Y0=1005;var u6=1006,Q5=1007;var v7=1008;var J7=1009,A$=1010,_$=1011,X0=1012,_1=1013,f7=1014,I7=1015,G7=1016,C1=1017,P1=1018,r7=1020,C$=35902,P$=35899,w$=1021,T$=1022,Q7=1023,y9=1026,b7=1027,S$=1028,w1=1029,t7=1030,T1=1031;var S1=1033,$5=33776,Z5=33777,W5=33778,q5=33779,j1=35840,y1=35841,v1=35842,f1=35843,b1=36196,h1=37492,x1=37496,g1=37488,p1=37489,K5=37490,m1=37491,l1=37808,d1=37809,u1=37810,c1=37811,n1=37812,s1=37813,i1=37814,o1=37815,a1=37816,r1=37817,t1=37818,e1=37819,JJ=37820,QJ=37821,$J=36492,ZJ=36494,WJ=36495,qJ=36283,KJ=36284,H5=36285,HJ=36286;var UJ=0,j$=1,e7="",v9="srgb",YJ="srgb-linear",XJ="linear",E6="srgb";var y$=512,v$=513,f$=514,GJ=515,b$=516,h$=517,NJ=518,EJ=519;var FJ="300 es",DJ=2000;function QW(J){for(let Q=J.length-1;Q>=0;--Q)if(J[Q]>=65535)return!0;return!1}function $W(J){return ArrayBuffer.isView(J)&&!(J instanceof DataView)}function Q0(J){return document.createElementNS("http://www.w3.org/1999/xhtml",J)}function x$(){let J=Q0("canvas");return J.style.display="block",J}var XQ={},A9=null;function OJ(...J){let Q="THREE."+J.shift();if(A9)A9("log",Q,...J);else console.log(Q,...J)}function g$(J){let Q=J[0];if(typeof Q==="string"&&Q.startsWith("TSL:")){let $=J[1];if($&&$.isStackTrace)J[0]+=" "+$.getLocation();else J[1]='Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.'}return J}function t8(...J){J=g$(J);let Q="THREE."+J.shift();if(A9)A9("warn",Q,...J);else{let $=J[0];if($&&$.isStackTrace)console.warn($.getError(Q));else console.warn(Q,...J)}}function e8(...J){J=g$(J);let Q="THREE."+J.shift();if(A9)A9("error",Q,...J);else{let $=J[0];if($&&$.isStackTrace)console.error($.getError(Q));else console.error(Q,...J)}}function s7(...J){let Q=J.join(" ");if(Q in XQ)return;XQ[Q]=!0,t8(...J)}function p$(J,Q,$){return new Promise(function(Z,W){function q(){switch(J.clientWaitSync(Q,J.SYNC_FLUSH_COMMANDS_BIT,0)){case J.WAIT_FAILED:W();break;case J.TIMEOUT_EXPIRED:setTimeout(q,$);break;default:Z()}}setTimeout(q,$)})}var m$={[0]:0,[2]:6,[4]:4,[3]:5,[1]:1,[6]:2,[7]:7,[5]:3};class A7{addEventListener(J,Q){if(this._listeners===void 0)this._listeners={};let $=this._listeners;if($[J]===void 0)$[J]=[];if($[J].indexOf(Q)===-1)$[J].push(Q)}hasEventListener(J,Q){let $=this._listeners;if($===void 0)return!1;return $[J]!==void 0&&$[J].indexOf(Q)!==-1}removeEventListener(J,Q){let $=this._listeners;if($===void 0)return;let Z=$[J];if(Z!==void 0){let W=Z.indexOf(Q);if(W!==-1)Z.splice(W,1)}}dispatchEvent(J){let Q=this._listeners;if(Q===void 0)return;let $=Q[J.type];if($!==void 0){J.target=this;let Z=$.slice(0);for(let W=0,q=Z.length;W<q;W++)Z[W].call(this,J);J.target=null}}}var y6=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"],GQ=1234567,r9=Math.PI/180,_9=180/Math.PI;function J9(){let J=Math.random()*4294967295|0,Q=Math.random()*4294967295|0,$=Math.random()*4294967295|0,Z=Math.random()*4294967295|0;return(y6[J&255]+y6[J>>8&255]+y6[J>>16&255]+y6[J>>24&255]+"-"+y6[Q&255]+y6[Q>>8&255]+"-"+y6[Q>>16&15|64]+y6[Q>>24&255]+"-"+y6[$&63|128]+y6[$>>8&255]+"-"+y6[$>>16&255]+y6[$>>24&255]+y6[Z&255]+y6[Z>>8&255]+y6[Z>>16&255]+y6[Z>>24&255]).toLowerCase()}function Z6(J,Q,$){return Math.max(Q,Math.min($,J))}function RJ(J,Q){return(J%Q+Q)%Q}function ZW(J,Q,$,Z,W){return Z+(J-Q)*(W-Z)/($-Q)}function WW(J,Q,$){if(J!==Q)return($-J)/(Q-J);else return 0}function t9(J,Q,$){return(1-$)*J+$*Q}function qW(J,Q,$,Z){return t9(J,Q,1-Math.exp(-$*Z))}function KW(J,Q=1){return Q-Math.abs(RJ(J,Q*2)-Q)}function HW(J,Q,$){if(J<=Q)return 0;if(J>=$)return 1;return J=(J-Q)/($-Q),J*J*(3-2*J)}function UW(J,Q,$){if(J<=Q)return 0;if(J>=$)return 1;return J=(J-Q)/($-Q),J*J*J*(J*(J*6-15)+10)}function YW(J,Q){return J+Math.floor(Math.random()*(Q-J+1))}function XW(J,Q){return J+Math.random()*(Q-J)}function GW(J){return J*(0.5-Math.random())}function NW(J){if(J!==void 0)GQ=J;let Q=GQ+=1831565813;return Q=Math.imul(Q^Q>>>15,Q|1),Q^=Q+Math.imul(Q^Q>>>7,Q|61),((Q^Q>>>14)>>>0)/4294967296}function EW(J){return J*r9}function FW(J){return J*_9}function DW(J){return J>0&&Number.isInteger(J)&&2**Math.round(Math.log2(J))===J}function OW(J){return Math.pow(2,Math.ceil(Math.log(J)/Math.LN2))}function MJ(J){return Math.pow(2,Math.floor(Math.log(J)/Math.LN2))}function RW(J,Q,$,Z,W){let{cos:q,sin:K}=Math,H=q($/2),U=K($/2),Y=q((Q+Z)/2),X=K((Q+Z)/2),G=q((Q-Z)/2),N=K((Q-Z)/2),F=q((Z-Q)/2),M=K((Z-Q)/2);switch(W){case"XYX":J.set(H*X,U*G,U*N,H*Y);break;case"YZY":J.set(U*N,H*X,U*G,H*Y);break;case"ZXZ":J.set(U*G,U*N,H*X,H*Y);break;case"XZX":J.set(H*X,U*M,U*F,H*Y);break;case"YXY":J.set(U*F,H*X,U*M,H*Y);break;case"ZYZ":J.set(U*M,U*F,H*X,H*Y);break;default:t8("MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+W)}}function kJ(J){switch(J.constructor){case Uint32Array:return 4294967295;case Uint16Array:return 65535;case Uint8Array:case Uint8ClampedArray:return 255;case Int32Array:return 2147483647;case Int16Array:return 32767;case Int8Array:return 127;default:return}}function l$(J,Q){if(Q.constructor===Float32Array)return J;let $=kJ(Q);if($===void 0)throw Error("THREE.MathUtils: Invalid component type.");return Math.max(J/$,-1)}function d$(J,Q){if(Q.constructor===Float32Array)return J;let $=kJ(Q);if($===void 0)throw Error("THREE.MathUtils: Invalid component type.");return Math.round(J*$)}var U5={DEG2RAD:r9,RAD2DEG:_9,generateUUID:J9,clamp:Z6,euclideanModulo:RJ,mapLinear:ZW,inverseLerp:WW,lerp:t9,damp:qW,pingpong:KW,smoothstep:HW,smootherstep:UW,randInt:YW,randFloat:XW,randFloatSpread:GW,seededRandom:NW,degToRad:EW,radToDeg:FW,isPowerOfTwo:DW,ceilPowerOfTwo:OW,floorPowerOfTwo:MJ,setQuaternionFromProperEuler:RW,normalize:d$,denormalize:l$};class L8{static{this.prototype.isVector2=!0}constructor(J=0,Q=0){this.x=J,this.y=Q}get width(){return this.x}set width(J){this.x=J}get height(){return this.y}set height(J){this.y=J}set(J,Q){return this.x=J,this.y=Q,this}setScalar(J){return this.x=J,this.y=J,this}setX(J){return this.x=J,this}setY(J){return this.y=J,this}setComponent(J,Q){switch(J){case 0:this.x=Q;break;case 1:this.y=Q;break;default:throw Error("THREE.Vector2: index is out of range: "+J)}return this}getComponent(J){switch(J){case 0:return this.x;case 1:return this.y;default:throw Error("THREE.Vector2: index is out of range: "+J)}}clone(){return new this.constructor(this.x,this.y)}copy(J){return this.x=J.x,this.y=J.y,this}add(J){return this.x+=J.x,this.y+=J.y,this}addScalar(J){return this.x+=J,this.y+=J,this}addVectors(J,Q){return this.x=J.x+Q.x,this.y=J.y+Q.y,this}addScaledVector(J,Q){return this.x+=J.x*Q,this.y+=J.y*Q,this}sub(J){return this.x-=J.x,this.y-=J.y,this}subScalar(J){return this.x-=J,this.y-=J,this}subVectors(J,Q){return this.x=J.x-Q.x,this.y=J.y-Q.y,this}multiply(J){return this.x*=J.x,this.y*=J.y,this}multiplyScalar(J){return this.x*=J,this.y*=J,this}divide(J){return this.x/=J.x,this.y/=J.y,this}divideScalar(J){return this.multiplyScalar(1/J)}applyMatrix3(J){let Q=this.x,$=this.y,Z=J.elements;return this.x=Z[0]*Q+Z[3]*$+Z[6],this.y=Z[1]*Q+Z[4]*$+Z[7],this}min(J){return this.x=Math.min(this.x,J.x),this.y=Math.min(this.y,J.y),this}max(J){return this.x=Math.max(this.x,J.x),this.y=Math.max(this.y,J.y),this}clamp(J,Q){return this.x=Z6(this.x,J.x,Q.x),this.y=Z6(this.y,J.y,Q.y),this}clampScalar(J,Q){return this.x=Z6(this.x,J,Q),this.y=Z6(this.y,J,Q),this}clampLength(J,Q){let $=this.length();return this.divideScalar($||1).multiplyScalar(Z6($,J,Q))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(J){return this.x*J.x+this.y*J.y}cross(J){return this.x*J.y-this.y*J.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(J){let Q=Math.sqrt(this.lengthSq()*J.lengthSq());if(Q===0)return Math.PI/2;let $=this.dot(J)/Q;return Math.acos(Z6($,-1,1))}distanceTo(J){return Math.sqrt(this.distanceToSquared(J))}distanceToSquared(J){let Q=this.x-J.x,$=this.y-J.y;return Q*Q+$*$}manhattanDistanceTo(J){return Math.abs(this.x-J.x)+Math.abs(this.y-J.y)}setLength(J){return this.normalize().multiplyScalar(J)}lerp(J,Q){return this.x+=(J.x-this.x)*Q,this.y+=(J.y-this.y)*Q,this}lerpVectors(J,Q,$){return this.x=J.x+(Q.x-J.x)*$,this.y=J.y+(Q.y-J.y)*$,this}equals(J){return J.x===this.x&&J.y===this.y}fromArray(J,Q=0){return this.x=J[Q],this.y=J[Q+1],this}toArray(J=[],Q=0){return J[Q]=this.x,J[Q+1]=this.y,J}fromBufferAttribute(J,Q){return this.x=J.getX(Q),this.y=J.getY(Q),this}rotateAround(J,Q){let $=Math.cos(Q),Z=Math.sin(Q),W=this.x-J.x,q=this.y-J.y;return this.x=W*$-q*Z+J.x,this.y=W*Z+q*$+J.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class _7{constructor(J=0,Q=0,$=0,Z=1){this.isQuaternion=!0,this._x=J,this._y=Q,this._z=$,this._w=Z}static slerpFlat(J,Q,$,Z,W,q,K){let H=$[Z+0],U=$[Z+1],Y=$[Z+2],X=$[Z+3],G=W[q+0],N=W[q+1],F=W[q+2],M=W[q+3];if(X!==M||H!==G||U!==N||Y!==F){let L=H*G+U*N+Y*F+X*M;if(L<0)G=-G,N=-N,F=-F,M=-M,L=-L;let E=1-K;if(L<0.9995){let O=Math.acos(L),_=Math.sin(O);E=Math.sin(E*O)/_,K=Math.sin(K*O)/_,H=H*E+G*K,U=U*E+N*K,Y=Y*E+F*K,X=X*E+M*K}else{H=H*E+G*K,U=U*E+N*K,Y=Y*E+F*K,X=X*E+M*K;let O=1/Math.sqrt(H*H+U*U+Y*Y+X*X);H*=O,U*=O,Y*=O,X*=O}}J[Q]=H,J[Q+1]=U,J[Q+2]=Y,J[Q+3]=X}static multiplyQuaternionsFlat(J,Q,$,Z,W,q){let K=$[Z],H=$[Z+1],U=$[Z+2],Y=$[Z+3],X=W[q],G=W[q+1],N=W[q+2],F=W[q+3];return J[Q]=K*F+Y*X+H*N-U*G,J[Q+1]=H*F+Y*G+U*X-K*N,J[Q+2]=U*F+Y*N+K*G-H*X,J[Q+3]=Y*F-K*X-H*G-U*N,J}get x(){return this._x}set x(J){this._x=J,this._onChangeCallback()}get y(){return this._y}set y(J){this._y=J,this._onChangeCallback()}get z(){return this._z}set z(J){this._z=J,this._onChangeCallback()}get w(){return this._w}set w(J){this._w=J,this._onChangeCallback()}set(J,Q,$,Z){return this._x=J,this._y=Q,this._z=$,this._w=Z,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(J){return this._x=J.x,this._y=J.y,this._z=J.z,this._w=J.w,this._onChangeCallback(),this}setFromEuler(J,Q=!0){let{_x:$,_y:Z,_z:W,_order:q}=J,K=Math.cos,H=Math.sin,U=K($/2),Y=K(Z/2),X=K(W/2),G=H($/2),N=H(Z/2),F=H(W/2);switch(q){case"XYZ":this._x=G*Y*X+U*N*F,this._y=U*N*X-G*Y*F,this._z=U*Y*F+G*N*X,this._w=U*Y*X-G*N*F;break;case"YXZ":this._x=G*Y*X+U*N*F,this._y=U*N*X-G*Y*F,this._z=U*Y*F-G*N*X,this._w=U*Y*X+G*N*F;break;case"ZXY":this._x=G*Y*X-U*N*F,this._y=U*N*X+G*Y*F,this._z=U*Y*F+G*N*X,this._w=U*Y*X-G*N*F;break;case"ZYX":this._x=G*Y*X-U*N*F,this._y=U*N*X+G*Y*F,this._z=U*Y*F-G*N*X,this._w=U*Y*X+G*N*F;break;case"YZX":this._x=G*Y*X+U*N*F,this._y=U*N*X+G*Y*F,this._z=U*Y*F-G*N*X,this._w=U*Y*X-G*N*F;break;case"XZY":this._x=G*Y*X-U*N*F,this._y=U*N*X-G*Y*F,this._z=U*Y*F+G*N*X,this._w=U*Y*X+G*N*F;break;default:t8("Quaternion: .setFromEuler() encountered an unknown order: "+q)}if(Q===!0)this._onChangeCallback();return this}setFromAxisAngle(J,Q){let $=Q/2,Z=Math.sin($);return this._x=J.x*Z,this._y=J.y*Z,this._z=J.z*Z,this._w=Math.cos($),this._onChangeCallback(),this}setFromRotationMatrix(J){let Q=J.elements,$=Q[0],Z=Q[4],W=Q[8],q=Q[1],K=Q[5],H=Q[9],U=Q[2],Y=Q[6],X=Q[10],G=$+K+X;if(G>0){let N=0.5/Math.sqrt(G+1);this._w=0.25/N,this._x=(Y-H)*N,this._y=(W-U)*N,this._z=(q-Z)*N}else if($>K&&$>X){let N=2*Math.sqrt(1+$-K-X);this._w=(Y-H)/N,this._x=0.25*N,this._y=(Z+q)/N,this._z=(W+U)/N}else if(K>X){let N=2*Math.sqrt(1+K-$-X);this._w=(W-U)/N,this._x=(Z+q)/N,this._y=0.25*N,this._z=(H+Y)/N}else{let N=2*Math.sqrt(1+X-$-K);this._w=(q-Z)/N,this._x=(W+U)/N,this._y=(H+Y)/N,this._z=0.25*N}return this._onChangeCallback(),this}setFromUnitVectors(J,Q){let $=J.dot(Q)+1;if($<0.00000001)if($=0,Math.abs(J.x)>Math.abs(J.z))this._x=-J.y,this._y=J.x,this._z=0,this._w=$;else this._x=0,this._y=-J.z,this._z=J.y,this._w=$;else this._x=J.y*Q.z-J.z*Q.y,this._y=J.z*Q.x-J.x*Q.z,this._z=J.x*Q.y-J.y*Q.x,this._w=$;return this.normalize()}angleTo(J){return 2*Math.acos(Math.abs(Z6(this.dot(J),-1,1)))}rotateTowards(J,Q){let $=this.angleTo(J);if($===0)return this;let Z=Math.min(1,Q/$);return this.slerp(J,Z),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(J){return this._x*J._x+this._y*J._y+this._z*J._z+this._w*J._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let J=this.length();if(J===0)this._x=0,this._y=0,this._z=0,this._w=1;else J=1/J,this._x=this._x*J,this._y=this._y*J,this._z=this._z*J,this._w=this._w*J;return this._onChangeCallback(),this}multiply(J){return this.multiplyQuaternions(this,J)}premultiply(J){return this.multiplyQuaternions(J,this)}multiplyQuaternions(J,Q){let{_x:$,_y:Z,_z:W,_w:q}=J,K=Q._x,H=Q._y,U=Q._z,Y=Q._w;return this._x=$*Y+q*K+Z*U-W*H,this._y=Z*Y+q*H+W*K-$*U,this._z=W*Y+q*U+$*H-Z*K,this._w=q*Y-$*K-Z*H-W*U,this._onChangeCallback(),this}slerp(J,Q){let{_x:$,_y:Z,_z:W,_w:q}=J,K=this.dot(J);if(K<0)$=-$,Z=-Z,W=-W,q=-q,K=-K;let H=1-Q;if(K<0.9995){let U=Math.acos(K),Y=Math.sin(U);H=Math.sin(H*U)/Y,Q=Math.sin(Q*U)/Y,this._x=this._x*H+$*Q,this._y=this._y*H+Z*Q,this._z=this._z*H+W*Q,this._w=this._w*H+q*Q,this._onChangeCallback()}else this._x=this._x*H+$*Q,this._y=this._y*H+Z*Q,this._z=this._z*H+W*Q,this._w=this._w*H+q*Q,this.normalize();return this}slerpQuaternions(J,Q,$){return this.copy(J).slerp(Q,$)}random(){let J=2*Math.PI*Math.random(),Q=2*Math.PI*Math.random(),$=Math.random(),Z=Math.sqrt(1-$),W=Math.sqrt($);return this.set(Z*Math.sin(J),Z*Math.cos(J),W*Math.sin(Q),W*Math.cos(Q))}equals(J){return J._x===this._x&&J._y===this._y&&J._z===this._z&&J._w===this._w}fromArray(J,Q=0){return this._x=J[Q],this._y=J[Q+1],this._z=J[Q+2],this._w=J[Q+3],this._onChangeCallback(),this}toArray(J=[],Q=0){return J[Q]=this._x,J[Q+1]=this._y,J[Q+2]=this._z,J[Q+3]=this._w,J}fromBufferAttribute(J,Q){return this._x=J.getX(Q),this._y=J.getY(Q),this._z=J.getZ(Q),this._w=J.getW(Q),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(J){return this._onChangeCallback=J,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class u{static{this.prototype.isVector3=!0}constructor(J=0,Q=0,$=0){this.x=J,this.y=Q,this.z=$}set(J,Q,$){if($===void 0)$=this.z;return this.x=J,this.y=Q,this.z=$,this}setScalar(J){return this.x=J,this.y=J,this.z=J,this}setX(J){return this.x=J,this}setY(J){return this.y=J,this}setZ(J){return this.z=J,this}setComponent(J,Q){switch(J){case 0:this.x=Q;break;case 1:this.y=Q;break;case 2:this.z=Q;break;default:throw Error("THREE.Vector3: index is out of range: "+J)}return this}getComponent(J){switch(J){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error("THREE.Vector3: index is out of range: "+J)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(J){return this.x=J.x,this.y=J.y,this.z=J.z,this}add(J){return this.x+=J.x,this.y+=J.y,this.z+=J.z,this}addScalar(J){return this.x+=J,this.y+=J,this.z+=J,this}addVectors(J,Q){return this.x=J.x+Q.x,this.y=J.y+Q.y,this.z=J.z+Q.z,this}addScaledVector(J,Q){return this.x+=J.x*Q,this.y+=J.y*Q,this.z+=J.z*Q,this}sub(J){return this.x-=J.x,this.y-=J.y,this.z-=J.z,this}subScalar(J){return this.x-=J,this.y-=J,this.z-=J,this}subVectors(J,Q){return this.x=J.x-Q.x,this.y=J.y-Q.y,this.z=J.z-Q.z,this}multiply(J){return this.x*=J.x,this.y*=J.y,this.z*=J.z,this}multiplyScalar(J){return this.x*=J,this.y*=J,this.z*=J,this}multiplyVectors(J,Q){return this.x=J.x*Q.x,this.y=J.y*Q.y,this.z=J.z*Q.z,this}applyEuler(J){return this.applyQuaternion(NQ.setFromEuler(J))}applyAxisAngle(J,Q){return this.applyQuaternion(NQ.setFromAxisAngle(J,Q))}applyMatrix3(J){let Q=this.x,$=this.y,Z=this.z,W=J.elements;return this.x=W[0]*Q+W[3]*$+W[6]*Z,this.y=W[1]*Q+W[4]*$+W[7]*Z,this.z=W[2]*Q+W[5]*$+W[8]*Z,this}applyNormalMatrix(J){return this.applyMatrix3(J).normalize()}applyMatrix4(J){let Q=this.x,$=this.y,Z=this.z,W=J.elements,q=1/(W[3]*Q+W[7]*$+W[11]*Z+W[15]);return this.x=(W[0]*Q+W[4]*$+W[8]*Z+W[12])*q,this.y=(W[1]*Q+W[5]*$+W[9]*Z+W[13])*q,this.z=(W[2]*Q+W[6]*$+W[10]*Z+W[14])*q,this}applyQuaternion(J){let Q=this.x,$=this.y,Z=this.z,W=J.x,q=J.y,K=J.z,H=J.w,U=2*(q*Z-K*$),Y=2*(K*Q-W*Z),X=2*(W*$-q*Q);return this.x=Q+H*U+q*X-K*Y,this.y=$+H*Y+K*U-W*X,this.z=Z+H*X+W*Y-q*U,this}project(J){return this.applyMatrix4(J.matrixWorldInverse).applyMatrix4(J.projectionMatrix)}unproject(J){return this.applyMatrix4(J.projectionMatrixInverse).applyMatrix4(J.matrixWorld)}transformDirection(J){let Q=this.x,$=this.y,Z=this.z,W=J.elements;return this.x=W[0]*Q+W[4]*$+W[8]*Z,this.y=W[1]*Q+W[5]*$+W[9]*Z,this.z=W[2]*Q+W[6]*$+W[10]*Z,this.normalize()}divide(J){return this.x/=J.x,this.y/=J.y,this.z/=J.z,this}divideScalar(J){return this.multiplyScalar(1/J)}min(J){return this.x=Math.min(this.x,J.x),this.y=Math.min(this.y,J.y),this.z=Math.min(this.z,J.z),this}max(J){return this.x=Math.max(this.x,J.x),this.y=Math.max(this.y,J.y),this.z=Math.max(this.z,J.z),this}clamp(J,Q){return this.x=Z6(this.x,J.x,Q.x),this.y=Z6(this.y,J.y,Q.y),this.z=Z6(this.z,J.z,Q.z),this}clampScalar(J,Q){return this.x=Z6(this.x,J,Q),this.y=Z6(this.y,J,Q),this.z=Z6(this.z,J,Q),this}clampLength(J,Q){let $=this.length();return this.divideScalar($||1).multiplyScalar(Z6($,J,Q))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(J){return this.x*J.x+this.y*J.y+this.z*J.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(J){return this.normalize().multiplyScalar(J)}lerp(J,Q){return this.x+=(J.x-this.x)*Q,this.y+=(J.y-this.y)*Q,this.z+=(J.z-this.z)*Q,this}lerpVectors(J,Q,$){return this.x=J.x+(Q.x-J.x)*$,this.y=J.y+(Q.y-J.y)*$,this.z=J.z+(Q.z-J.z)*$,this}cross(J){return this.crossVectors(this,J)}crossVectors(J,Q){let{x:$,y:Z,z:W}=J,q=Q.x,K=Q.y,H=Q.z;return this.x=Z*H-W*K,this.y=W*q-$*H,this.z=$*K-Z*q,this}projectOnVector(J){let Q=J.lengthSq();if(Q===0)return this.set(0,0,0);let $=J.dot(this)/Q;return this.copy(J).multiplyScalar($)}projectOnPlane(J){return l5.copy(this).projectOnVector(J),this.sub(l5)}reflect(J){return this.sub(l5.copy(J).multiplyScalar(2*this.dot(J)))}angleTo(J){let Q=Math.sqrt(this.lengthSq()*J.lengthSq());if(Q===0)return Math.PI/2;let $=this.dot(J)/Q;return Math.acos(Z6($,-1,1))}distanceTo(J){return Math.sqrt(this.distanceToSquared(J))}distanceToSquared(J){let Q=this.x-J.x,$=this.y-J.y,Z=this.z-J.z;return Q*Q+$*$+Z*Z}manhattanDistanceTo(J){return Math.abs(this.x-J.x)+Math.abs(this.y-J.y)+Math.abs(this.z-J.z)}setFromSpherical(J){return this.setFromSphericalCoords(J.radius,J.phi,J.theta)}setFromSphericalCoords(J,Q,$){let Z=Math.sin(Q)*J;return this.x=Z*Math.sin($),this.y=Math.cos(Q)*J,this.z=Z*Math.cos($),this}setFromCylindrical(J){return this.setFromCylindricalCoords(J.radius,J.theta,J.y)}setFromCylindricalCoords(J,Q,$){return this.x=J*Math.sin(Q),this.y=$,this.z=J*Math.cos(Q),this}setFromMatrixPosition(J){let Q=J.elements;return this.x=Q[12],this.y=Q[13],this.z=Q[14],this}setFromMatrixScale(J){let Q=this.setFromMatrixColumn(J,0).length(),$=this.setFromMatrixColumn(J,1).length(),Z=this.setFromMatrixColumn(J,2).length();return this.x=Q,this.y=$,this.z=Z,this}setFromMatrixColumn(J,Q){return this.fromArray(J.elements,Q*4)}setFromMatrix3Column(J,Q){return this.fromArray(J.elements,Q*3)}setFromEuler(J){return this.x=J._x,this.y=J._y,this.z=J._z,this}setFromColor(J){return this.x=J.r,this.y=J.g,this.z=J.b,this}equals(J){return J.x===this.x&&J.y===this.y&&J.z===this.z}fromArray(J,Q=0){return this.x=J[Q],this.y=J[Q+1],this.z=J[Q+2],this}toArray(J=[],Q=0){return J[Q]=this.x,J[Q+1]=this.y,J[Q+2]=this.z,J}fromBufferAttribute(J,Q){return this.x=J.getX(Q),this.y=J.getY(Q),this.z=J.getZ(Q),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let J=Math.random()*Math.PI*2,Q=Math.random()*2-1,$=Math.sqrt(1-Q*Q);return this.x=$*Math.cos(J),this.y=Q,this.z=$*Math.sin(J),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}var l5=new u,NQ=new _7;class i8{static{this.prototype.isMatrix3=!0}constructor(J,Q,$,Z,W,q,K,H,U){if(this.elements=[1,0,0,0,1,0,0,0,1],J!==void 0)this.set(J,Q,$,Z,W,q,K,H,U)}set(J,Q,$,Z,W,q,K,H,U){let Y=this.elements;return Y[0]=J,Y[1]=Z,Y[2]=K,Y[3]=Q,Y[4]=W,Y[5]=H,Y[6]=$,Y[7]=q,Y[8]=U,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(J){let Q=this.elements,$=J.elements;return Q[0]=$[0],Q[1]=$[1],Q[2]=$[2],Q[3]=$[3],Q[4]=$[4],Q[5]=$[5],Q[6]=$[6],Q[7]=$[7],Q[8]=$[8],this}extractBasis(J,Q,$){return J.setFromMatrix3Column(this,0),Q.setFromMatrix3Column(this,1),$.setFromMatrix3Column(this,2),this}setFromMatrix4(J){let Q=J.elements;return this.set(Q[0],Q[4],Q[8],Q[1],Q[5],Q[9],Q[2],Q[6],Q[10]),this}multiply(J){return this.multiplyMatrices(this,J)}premultiply(J){return this.multiplyMatrices(J,this)}multiplyMatrices(J,Q){let $=J.elements,Z=Q.elements,W=this.elements,q=$[0],K=$[3],H=$[6],U=$[1],Y=$[4],X=$[7],G=$[2],N=$[5],F=$[8],M=Z[0],L=Z[3],E=Z[6],O=Z[1],_=Z[4],V=Z[7],B=Z[2],w=Z[5],y=Z[8];return W[0]=q*M+K*O+H*B,W[3]=q*L+K*_+H*w,W[6]=q*E+K*V+H*y,W[1]=U*M+Y*O+X*B,W[4]=U*L+Y*_+X*w,W[7]=U*E+Y*V+X*y,W[2]=G*M+N*O+F*B,W[5]=G*L+N*_+F*w,W[8]=G*E+N*V+F*y,this}multiplyScalar(J){let Q=this.elements;return Q[0]*=J,Q[3]*=J,Q[6]*=J,Q[1]*=J,Q[4]*=J,Q[7]*=J,Q[2]*=J,Q[5]*=J,Q[8]*=J,this}determinant(){let J=this.elements,Q=J[0],$=J[1],Z=J[2],W=J[3],q=J[4],K=J[5],H=J[6],U=J[7],Y=J[8];return Q*q*Y-Q*K*U-$*W*Y+$*K*H+Z*W*U-Z*q*H}invert(){let J=this.elements,Q=J[0],$=J[1],Z=J[2],W=J[3],q=J[4],K=J[5],H=J[6],U=J[7],Y=J[8],X=Y*q-K*U,G=K*H-Y*W,N=U*W-q*H,F=Q*X+$*G+Z*N;if(F===0)return this.set(0,0,0,0,0,0,0,0,0);let M=1/F;return J[0]=X*M,J[1]=(Z*U-Y*$)*M,J[2]=(K*$-Z*q)*M,J[3]=G*M,J[4]=(Y*Q-Z*H)*M,J[5]=(Z*W-K*Q)*M,J[6]=N*M,J[7]=($*H-U*Q)*M,J[8]=(q*Q-$*W)*M,this}transpose(){let J,Q=this.elements;return J=Q[1],Q[1]=Q[3],Q[3]=J,J=Q[2],Q[2]=Q[6],Q[6]=J,J=Q[5],Q[5]=Q[7],Q[7]=J,this}getNormalMatrix(J){return this.setFromMatrix4(J).invert().transpose()}transposeIntoArray(J){let Q=this.elements;return J[0]=Q[0],J[1]=Q[3],J[2]=Q[6],J[3]=Q[1],J[4]=Q[4],J[5]=Q[7],J[6]=Q[2],J[7]=Q[5],J[8]=Q[8],this}setUvTransform(J,Q,$,Z,W,q,K){let H=Math.cos(W),U=Math.sin(W);return this.set($*H,$*U,-$*(H*q+U*K)+q+J,-Z*U,Z*H,-Z*(-U*q+H*K)+K+Q,0,0,1),this}scale(J,Q){return s7("Matrix3: .scale() is deprecated. Use .makeScale() instead."),this.premultiply(d5.makeScale(J,Q)),this}rotate(J){return s7("Matrix3: .rotate() is deprecated. Use .makeRotation() instead."),this.premultiply(d5.makeRotation(-J)),this}translate(J,Q){return s7("Matrix3: .translate() is deprecated. Use .makeTranslation() instead."),this.premultiply(d5.makeTranslation(J,Q)),this}makeTranslation(J,Q){if(J.isVector2)this.set(1,0,J.x,0,1,J.y,0,0,1);else this.set(1,0,J,0,1,Q,0,0,1);return this}makeRotation(J){let Q=Math.cos(J),$=Math.sin(J);return this.set(Q,-$,0,$,Q,0,0,0,1),this}makeScale(J,Q){return this.set(J,0,0,0,Q,0,0,0,1),this}equals(J){let Q=this.elements,$=J.elements;for(let Z=0;Z<9;Z++)if(Q[Z]!==$[Z])return!1;return!0}fromArray(J,Q=0){for(let $=0;$<9;$++)this.elements[$]=J[$+Q];return this}toArray(J=[],Q=0){let $=this.elements;return J[Q]=$[0],J[Q+1]=$[1],J[Q+2]=$[2],J[Q+3]=$[3],J[Q+4]=$[4],J[Q+5]=$[5],J[Q+6]=$[6],J[Q+7]=$[7],J[Q+8]=$[8],J}clone(){return new this.constructor().fromArray(this.elements)}}var d5=new i8,EQ=new i8().set(0.4123908,0.3575843,0.1804808,0.212639,0.7151687,0.0721923,0.0193308,0.1191948,0.9505322),FQ=new i8().set(3.2409699,-1.5373832,-0.4986108,-0.9692436,1.8759675,0.0415551,0.0556301,-0.203977,1.0569715);function MW(){let J={enabled:!0,workingColorSpace:"srgb-linear",spaces:{},convert:function(W,q,K){if(this.enabled===!1||q===K||!q||!K)return W;if(this.spaces[q].transfer==="srgb")W.r=z7(W.r),W.g=z7(W.g),W.b=z7(W.b);if(this.spaces[q].primaries!==this.spaces[K].primaries)W.applyMatrix3(this.spaces[q].toXYZ),W.applyMatrix3(this.spaces[K].fromXYZ);if(this.spaces[K].transfer==="srgb")W.r=I9(W.r),W.g=I9(W.g),W.b=I9(W.b);return W},workingToColorSpace:function(W,q){return this.convert(W,this.workingColorSpace,q)},colorSpaceToWorking:function(W,q){return this.convert(W,q,this.workingColorSpace)},getPrimaries:function(W){return this.spaces[W].primaries},getTransfer:function(W){if(W==="")return"linear";return this.spaces[W].transfer},getToneMappingMode:function(W){return this.spaces[W].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(W,q=this.workingColorSpace){return W.fromArray(this.spaces[q].luminanceCoefficients)},define:function(W){Object.assign(this.spaces,W)},_getMatrix:function(W,q,K){return W.copy(this.spaces[K].fromXYZ).multiply(this.spaces[q].toXYZ)},_getDrawingBufferColorSpace:function(W){return this.spaces[W].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(W=this.workingColorSpace){return this.spaces[W].workingColorSpaceConfig.unpackColorSpace}},Q=[0.64,0.33,0.3,0.6,0.15,0.06],$=[0.2126,0.7152,0.0722],Z=[0.3127,0.329];return J.define({["srgb-linear"]:{primaries:Q,whitePoint:Z,transfer:"linear",toXYZ:EQ,fromXYZ:FQ,luminanceCoefficients:$,workingColorSpaceConfig:{unpackColorSpace:"srgb"},outputColorSpaceConfig:{drawingBufferColorSpace:"srgb"}},["srgb"]:{primaries:Q,whitePoint:Z,transfer:"srgb",toXYZ:EQ,fromXYZ:FQ,luminanceCoefficients:$,outputColorSpaceConfig:{drawingBufferColorSpace:"srgb"}}}),J}var K6=MW();function z7(J){return J<0.04045?J*0.0773993808:Math.pow(J*0.9478672986+0.0521327014,2.4)}function I9(J){return J<0.0031308?J*12.92:1.055*Math.pow(J,0.41666)-0.055}var X9;class LJ{static getDataURL(J,Q="image/png"){if(/^data:/i.test(J.src))return J.src;if(typeof HTMLCanvasElement>"u")return J.src;let $;if(J instanceof HTMLCanvasElement)$=J;else{if(X9===void 0)X9=Q0("canvas");X9.width=J.width,X9.height=J.height;let Z=X9.getContext("2d");if(J instanceof ImageData)Z.putImageData(J,0,0);else Z.drawImage(J,0,0,J.width,J.height);$=X9}return $.toDataURL(Q)}static sRGBToLinear(J){if(typeof HTMLImageElement<"u"&&J instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&J instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&J instanceof ImageBitmap){let Q=Q0("canvas");Q.width=J.width,Q.height=J.height;let $=Q.getContext("2d");$.drawImage(J,0,0,J.width,J.height);let Z=$.getImageData(0,0,J.width,J.height),W=Z.data;for(let q=0;q<W.length;q++)W[q]=z7(W[q]/255)*255;return $.putImageData(Z,0,0),Q}else if(J.data){let Q=J.data.slice(0);for(let $=0;$<Q.length;$++)if(Q instanceof Uint8Array||Q instanceof Uint8ClampedArray)Q[$]=Math.floor(z7(Q[$]/255)*255);else Q[$]=z7(Q[$]);return{data:Q,width:J.width,height:J.height}}else return t8("ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),J}}var kW=0;class G0{constructor(J=null){this.isTextureSource=!0,Object.defineProperty(this,"id",{value:kW++}),this.uuid=J9(),this.data=J,this.dataReady=!0,this.version=0}getSize(J){let Q=this.data;if(typeof HTMLVideoElement<"u"&&Q instanceof HTMLVideoElement)J.set(Q.videoWidth,Q.videoHeight,0);else if(typeof VideoFrame<"u"&&Q instanceof VideoFrame)J.set(Q.displayWidth,Q.displayHeight,0);else if(Q!==null)J.set(Q.width||0,Q.height||0,Q.depth||0);else J.set(0,0,0);return J}set needsUpdate(J){if(J===!0)this.version++}toJSON(J){let Q=J===void 0||typeof J==="string";if(!Q&&J.images[this.uuid]!==void 0)return J.images[this.uuid];let $={uuid:this.uuid,url:""},Z=this.data;if(Z!==null){let W;if(Array.isArray(Z)){W=[];for(let q=0,K=Z.length;q<K;q++)if(Z[q].isDataTexture)W.push(u5(Z[q].image));else W.push(u5(Z[q]))}else W=u5(Z);$.url=W}if(!Q)J.images[this.uuid]=$;return $}}function u5(J){if(typeof HTMLImageElement<"u"&&J instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&J instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&J instanceof ImageBitmap)return LJ.getDataURL(J);else if(J.data)return{data:Array.from(J.data),width:J.width,height:J.height,type:J.data.constructor.name};else return t8("Texture: Unable to serialize Texture."),{}}var LW=0,c5=new u;class w6 extends A7{constructor(J=w6.DEFAULT_IMAGE,Q=w6.DEFAULT_MAPPING,$=1001,Z=1001,W=1006,q=1008,K=1023,H=1009,U=w6.DEFAULT_ANISOTROPY,Y=""){super();this.isTexture=!0,Object.defineProperty(this,"id",{value:LW++}),this.uuid=J9(),this.name="",this.source=new G0(J),this.mipmaps=[],this.mapping=Q,this.channel=0,this.wrapS=$,this.wrapT=Z,this.magFilter=W,this.minFilter=q,this.anisotropy=U,this.format=K,this.internalFormat=null,this.type=H,this.offset=new L8(0,0),this.repeat=new L8(1,1),this.center=new L8(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new i8,this.generateMipmaps=!0,this.mipmapsAutoUpdate=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=Y,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=J&&J.depth&&J.depth>1?!0:!1,this.pmremVersion=0,this.isPMREMTexture=!1,this.normalized=!1}get width(){return this.source.getSize(c5).x}get height(){return this.source.getSize(c5).y}get depth(){return this.source.getSize(c5).z}get image(){return this.source.data}set image(J){this.source.data=J}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(J,Q){this.updateRanges.push({start:J,count:Q})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(J){return this.name=J.name,this.source=J.source,this.mipmaps=J.mipmaps.slice(0),this.mapping=J.mapping,this.channel=J.channel,this.wrapS=J.wrapS,this.wrapT=J.wrapT,this.magFilter=J.magFilter,this.minFilter=J.minFilter,this.anisotropy=J.anisotropy,this.format=J.format,this.internalFormat=J.internalFormat,this.type=J.type,this.normalized=J.normalized,this.offset.copy(J.offset),this.repeat.copy(J.repeat),this.center.copy(J.center),this.rotation=J.rotation,this.matrixAutoUpdate=J.matrixAutoUpdate,this.matrix.copy(J.matrix),this.generateMipmaps=J.generateMipmaps,this.mipmapsAutoUpdate=J.mipmapsAutoUpdate,this.premultiplyAlpha=J.premultiplyAlpha,this.flipY=J.flipY,this.unpackAlignment=J.unpackAlignment,this.colorSpace=J.colorSpace,this.renderTarget=J.renderTarget,this.isRenderTargetTexture=J.isRenderTargetTexture,this.isPMREMTexture=J.isPMREMTexture,this.isArrayTexture=J.isArrayTexture,this.userData=JSON.parse(JSON.stringify(J.userData)),this.needsUpdate=!0,this}setValues(J){for(let Q in J){let $=J[Q];if($===void 0){t8(`Texture.setValues(): parameter '${Q}' has value of undefined.`);continue}let Z=this[Q];if(Z===void 0){t8(`Texture.setValues(): property '${Q}' does not exist.`);continue}if(Z&&$&&(Z.isVector2&&$.isVector2))Z.copy($);else if(Z&&$&&(Z.isVector3&&$.isVector3))Z.copy($);else if(Z&&$&&(Z.isMatrix3&&$.isMatrix3))Z.copy($);else this[Q]=$}}toJSON(J){let Q=J===void 0||typeof J==="string";if(!Q&&J.textures[this.uuid]!==void 0)return J.textures[this.uuid];let $={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(J).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,normalized:this.normalized,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,mipmapsAutoUpdate:this.mipmapsAutoUpdate,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};if(Object.keys(this.userData).length>0)$.userData=this.userData;if(!Q)J.textures[this.uuid]=$;return $}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(J){if(this.mapping!==300)return J;if(J.applyMatrix3(this.matrix),J.x<0||J.x>1)switch(this.wrapS){case 1000:J.x=J.x-Math.floor(J.x);break;case 1001:J.x=J.x<0?0:1;break;case 1002:if(Math.abs(Math.floor(J.x)%2)===1)J.x=Math.ceil(J.x)-J.x;else J.x=J.x-Math.floor(J.x);break}if(J.y<0||J.y>1)switch(this.wrapT){case 1000:J.y=J.y-Math.floor(J.y);break;case 1001:J.y=J.y<0?0:1;break;case 1002:if(Math.abs(Math.floor(J.y)%2)===1)J.y=Math.ceil(J.y)-J.y;else J.y=J.y-Math.floor(J.y);break}if(this.flipY)J.y=1-J.y;return J}set needsUpdate(J){if(J===!0)this.version++,this.source.needsUpdate=!0}set needsPMREMUpdate(J){if(J===!0)this.pmremVersion++}}w6.DEFAULT_IMAGE=null;w6.DEFAULT_MAPPING=300;w6.DEFAULT_ANISOTROPY=1;class R6{static{this.prototype.isVector4=!0}constructor(J=0,Q=0,$=0,Z=1){this.x=J,this.y=Q,this.z=$,this.w=Z}get width(){return this.z}set width(J){this.z=J}get height(){return this.w}set height(J){this.w=J}set(J,Q,$,Z){return this.x=J,this.y=Q,this.z=$,this.w=Z,this}setScalar(J){return this.x=J,this.y=J,this.z=J,this.w=J,this}setX(J){return this.x=J,this}setY(J){return this.y=J,this}setZ(J){return this.z=J,this}setW(J){return this.w=J,this}setComponent(J,Q){switch(J){case 0:this.x=Q;break;case 1:this.y=Q;break;case 2:this.z=Q;break;case 3:this.w=Q;break;default:throw Error("THREE.Vector4: index is out of range: "+J)}return this}getComponent(J){switch(J){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error("THREE.Vector4: index is out of range: "+J)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(J){return this.x=J.x,this.y=J.y,this.z=J.z,this.w=J.w!==void 0?J.w:1,this}add(J){return this.x+=J.x,this.y+=J.y,this.z+=J.z,this.w+=J.w,this}addScalar(J){return this.x+=J,this.y+=J,this.z+=J,this.w+=J,this}addVectors(J,Q){return this.x=J.x+Q.x,this.y=J.y+Q.y,this.z=J.z+Q.z,this.w=J.w+Q.w,this}addScaledVector(J,Q){return this.x+=J.x*Q,this.y+=J.y*Q,this.z+=J.z*Q,this.w+=J.w*Q,this}sub(J){return this.x-=J.x,this.y-=J.y,this.z-=J.z,this.w-=J.w,this}subScalar(J){return this.x-=J,this.y-=J,this.z-=J,this.w-=J,this}subVectors(J,Q){return this.x=J.x-Q.x,this.y=J.y-Q.y,this.z=J.z-Q.z,this.w=J.w-Q.w,this}multiply(J){return this.x*=J.x,this.y*=J.y,this.z*=J.z,this.w*=J.w,this}multiplyScalar(J){return this.x*=J,this.y*=J,this.z*=J,this.w*=J,this}applyMatrix4(J){let Q=this.x,$=this.y,Z=this.z,W=this.w,q=J.elements;return this.x=q[0]*Q+q[4]*$+q[8]*Z+q[12]*W,this.y=q[1]*Q+q[5]*$+q[9]*Z+q[13]*W,this.z=q[2]*Q+q[6]*$+q[10]*Z+q[14]*W,this.w=q[3]*Q+q[7]*$+q[11]*Z+q[15]*W,this}divide(J){return this.x/=J.x,this.y/=J.y,this.z/=J.z,this.w/=J.w,this}divideScalar(J){return this.multiplyScalar(1/J)}setAxisAngleFromQuaternion(J){this.w=2*Math.acos(J.w);let Q=Math.sqrt(1-J.w*J.w);if(Q<0.0001)this.x=1,this.y=0,this.z=0;else this.x=J.x/Q,this.y=J.y/Q,this.z=J.z/Q;return this}setAxisAngleFromRotationMatrix(J){let Q,$,Z,W,q=0.01,K=0.1,H=J.elements,U=H[0],Y=H[4],X=H[8],G=H[1],N=H[5],F=H[9],M=H[2],L=H[6],E=H[10];if(Math.abs(Y-G)<0.01&&Math.abs(X-M)<0.01&&Math.abs(F-L)<0.01){if(Math.abs(Y+G)<0.1&&Math.abs(X+M)<0.1&&Math.abs(F+L)<0.1&&Math.abs(U+N+E-3)<0.1)return this.set(1,0,0,0),this;Q=Math.PI;let _=(U+1)/2,V=(N+1)/2,B=(E+1)/2,w=(Y+G)/4,y=(X+M)/4,D=(F+L)/4;if(_>V&&_>B)if(_<0.01)$=0,Z=0.707106781,W=0.707106781;else $=Math.sqrt(_),Z=w/$,W=y/$;else if(V>B)if(V<0.01)$=0.707106781,Z=0,W=0.707106781;else Z=Math.sqrt(V),$=w/Z,W=D/Z;else if(B<0.01)$=0.707106781,Z=0.707106781,W=0;else W=Math.sqrt(B),$=y/W,Z=D/W;return this.set($,Z,W,Q),this}let O=Math.sqrt((L-F)*(L-F)+(X-M)*(X-M)+(G-Y)*(G-Y));if(Math.abs(O)<0.001)O=1;return this.x=(L-F)/O,this.y=(X-M)/O,this.z=(G-Y)/O,this.w=Math.acos((U+N+E-1)/2),this}setFromMatrixPosition(J){let Q=J.elements;return this.x=Q[12],this.y=Q[13],this.z=Q[14],this.w=Q[15],this}min(J){return this.x=Math.min(this.x,J.x),this.y=Math.min(this.y,J.y),this.z=Math.min(this.z,J.z),this.w=Math.min(this.w,J.w),this}max(J){return this.x=Math.max(this.x,J.x),this.y=Math.max(this.y,J.y),this.z=Math.max(this.z,J.z),this.w=Math.max(this.w,J.w),this}clamp(J,Q){return this.x=Z6(this.x,J.x,Q.x),this.y=Z6(this.y,J.y,Q.y),this.z=Z6(this.z,J.z,Q.z),this.w=Z6(this.w,J.w,Q.w),this}clampScalar(J,Q){return this.x=Z6(this.x,J,Q),this.y=Z6(this.y,J,Q),this.z=Z6(this.z,J,Q),this.w=Z6(this.w,J,Q),this}clampLength(J,Q){let $=this.length();return this.divideScalar($||1).multiplyScalar(Z6($,J,Q))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(J){return this.x*J.x+this.y*J.y+this.z*J.z+this.w*J.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(J){return this.normalize().multiplyScalar(J)}lerp(J,Q){return this.x+=(J.x-this.x)*Q,this.y+=(J.y-this.y)*Q,this.z+=(J.z-this.z)*Q,this.w+=(J.w-this.w)*Q,this}lerpVectors(J,Q,$){return this.x=J.x+(Q.x-J.x)*$,this.y=J.y+(Q.y-J.y)*$,this.z=J.z+(Q.z-J.z)*$,this.w=J.w+(Q.w-J.w)*$,this}equals(J){return J.x===this.x&&J.y===this.y&&J.z===this.z&&J.w===this.w}fromArray(J,Q=0){return this.x=J[Q],this.y=J[Q+1],this.z=J[Q+2],this.w=J[Q+3],this}toArray(J=[],Q=0){return J[Q]=this.x,J[Q+1]=this.y,J[Q+2]=this.z,J[Q+3]=this.w,J}fromBufferAttribute(J,Q){return this.x=J.getX(Q),this.y=J.getY(Q),this.z=J.getZ(Q),this.w=J.getW(Q),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class BJ extends A7{constructor(J=1,Q=1,$={}){super();$=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:1006,depthBuffer:!0,stencilBuffer:!1,resolveColorBuffer:!0,resolveDepthBuffer:!0,resolveStencilBuffer:!0,storeMultisampledColorBuffer:!0,storeMultisampledDepthBuffer:!0,storeMultisampledStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1,useArrayDepthTexture:!1},$),this.isRenderTarget=!0,this.width=J,this.height=Q,this.depth=$.depth,this.scissor=new R6(0,0,J,Q),this.scissorTest=!1,this.viewport=new R6(0,0,J,Q),this.textures=[];let Z=$.count;for(let W=0;W<Z;W++)this.textures[W]=new w6({width:J,height:Q,depth:$.depth}),this.textures[W].isRenderTargetTexture=!0,this.textures[W].renderTarget=this;this._setTextureOptions($),this.depthBuffer=$.depthBuffer,this.stencilBuffer=$.stencilBuffer,this.resolveColorBuffer=$.resolveColorBuffer,this.resolveDepthBuffer=$.resolveDepthBuffer,this.resolveStencilBuffer=$.resolveStencilBuffer,this.storeMultisampledColorBuffer=$.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=$.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=$.storeMultisampledStencilBuffer,this._depthTexture=null,this.depthTexture=$.depthTexture,this.samples=$.samples,this.multiview=$.multiview,this.useArrayDepthTexture=$.useArrayDepthTexture}_setTextureOptions(J={}){let Q={minFilter:1006,generateMipmaps:!1,flipY:!1,internalFormat:null};if(J.mapping!==void 0)Q.mapping=J.mapping;if(J.wrapS!==void 0)Q.wrapS=J.wrapS;if(J.wrapT!==void 0)Q.wrapT=J.wrapT;if(J.wrapR!==void 0)Q.wrapR=J.wrapR;if(J.magFilter!==void 0)Q.magFilter=J.magFilter;if(J.minFilter!==void 0)Q.minFilter=J.minFilter;if(J.format!==void 0)Q.format=J.format;if(J.type!==void 0)Q.type=J.type;if(J.anisotropy!==void 0)Q.anisotropy=J.anisotropy;if(J.colorSpace!==void 0)Q.colorSpace=J.colorSpace;if(J.flipY!==void 0)Q.flipY=J.flipY;if(J.generateMipmaps!==void 0)Q.generateMipmaps=J.generateMipmaps;if(J.mipmapsAutoUpdate!==void 0)Q.mipmapsAutoUpdate=J.mipmapsAutoUpdate;if(J.internalFormat!==void 0)Q.internalFormat=J.internalFormat;for(let $=0;$<this.textures.length;$++)this.textures[$].setValues(Q)}get texture(){return this.textures[0]}set texture(J){this.textures[0]=J}set depthTexture(J){if(this._depthTexture!==null&&this._depthTexture.renderTarget===this)this._depthTexture.renderTarget=null;if(J!==null&&J.renderTarget===null)J.renderTarget=this;this._depthTexture=J}get depthTexture(){return this._depthTexture}setSize(J,Q,$=1){if(this.width!==J||this.height!==Q||this.depth!==$){this.width=J,this.height=Q,this.depth=$;for(let Z=0,W=this.textures.length;Z<W;Z++)if(this.textures[Z].image.width=J,this.textures[Z].image.height=Q,this.textures[Z].image.depth=$,this.textures[Z].isData3DTexture!==!0)this.textures[Z].isArrayTexture=this.textures[Z].image.depth>1;this.dispose()}this.viewport.set(0,0,J,Q),this.scissor.set(0,0,J,Q)}clone(){return new this.constructor().copy(this)}copy(J){this.width=J.width,this.height=J.height,this.depth=J.depth,this.scissor.copy(J.scissor),this.scissorTest=J.scissorTest,this.viewport.copy(J.viewport),this.textures.length=0;for(let Q=0,$=J.textures.length;Q<$;Q++){this.textures[Q]=J.textures[Q].clone(),this.textures[Q].isRenderTargetTexture=!0,this.textures[Q].renderTarget=this;let Z=Object.assign({},J.textures[Q].image);this.textures[Q].source=new G0(Z)}if(this.depthBuffer=J.depthBuffer,this.stencilBuffer=J.stencilBuffer,this.resolveColorBuffer=J.resolveColorBuffer,this.resolveDepthBuffer=J.resolveDepthBuffer,this.resolveStencilBuffer=J.resolveStencilBuffer,this.storeMultisampledColorBuffer=J.storeMultisampledColorBuffer,this.storeMultisampledDepthBuffer=J.storeMultisampledDepthBuffer,this.storeMultisampledStencilBuffer=J.storeMultisampledStencilBuffer,J.depthTexture!==null)if(J.depthTexture.renderTarget===J){let Q=J.depthTexture.clone();Q.renderTarget=null,this.depthTexture=Q}else this.depthTexture=J.depthTexture;else this.depthTexture=null;return this.samples=J.samples,this.multiview=J.multiview,this.useArrayDepthTexture=J.useArrayDepthTexture,this}dispose(){this.dispatchEvent({type:"dispose"})}}class c6 extends BJ{constructor(J=1,Q=1,$={}){super(J,Q,$);this.isWebGLRenderTarget=!0}}class Y5 extends w6{constructor(J=null,Q=1,$=1,Z=1){super(null);this.isDataArrayTexture=!0,this.image={data:J,width:Q,height:$,depth:Z},this.magFilter=1003,this.minFilter=1003,this.wrapR=1001,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}copy(J){return super.copy(J),this.wrapR=J.wrapR,this}addLayerUpdate(J){this.layerUpdates.add(J)}clearLayerUpdates(){this.layerUpdates.clear()}}class zJ extends w6{constructor(J=null,Q=1,$=1,Z=1){super(null);this.isData3DTexture=!0,this.image={data:J,width:Q,height:$,depth:Z},this.magFilter=1003,this.minFilter=1003,this.wrapR=1001,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}copy(J){return super.copy(J),this.wrapR=J.wrapR,this}}class G6{static{this.prototype.isMatrix4=!0}constructor(J,Q,$,Z,W,q,K,H,U,Y,X,G,N,F,M,L){if(this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],J!==void 0)this.set(J,Q,$,Z,W,q,K,H,U,Y,X,G,N,F,M,L)}set(J,Q,$,Z,W,q,K,H,U,Y,X,G,N,F,M,L){let E=this.elements;return E[0]=J,E[4]=Q,E[8]=$,E[12]=Z,E[1]=W,E[5]=q,E[9]=K,E[13]=H,E[2]=U,E[6]=Y,E[10]=X,E[14]=G,E[3]=N,E[7]=F,E[11]=M,E[15]=L,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new G6().fromArray(this.elements)}copy(J){let Q=this.elements,$=J.elements;return Q[0]=$[0],Q[1]=$[1],Q[2]=$[2],Q[3]=$[3],Q[4]=$[4],Q[5]=$[5],Q[6]=$[6],Q[7]=$[7],Q[8]=$[8],Q[9]=$[9],Q[10]=$[10],Q[11]=$[11],Q[12]=$[12],Q[13]=$[13],Q[14]=$[14],Q[15]=$[15],this}copyPosition(J){let Q=this.elements,$=J.elements;return Q[12]=$[12],Q[13]=$[13],Q[14]=$[14],this}setFromMatrix3(J){let Q=J.elements;return this.set(Q[0],Q[3],Q[6],0,Q[1],Q[4],Q[7],0,Q[2],Q[5],Q[8],0,0,0,0,1),this}extractBasis(J,Q,$){if(this.determinantAffine()===0)return J.set(1,0,0),Q.set(0,1,0),$.set(0,0,1),this;return J.setFromMatrixColumn(this,0),Q.setFromMatrixColumn(this,1),$.setFromMatrixColumn(this,2),this}makeBasis(J,Q,$){return this.set(J.x,Q.x,$.x,0,J.y,Q.y,$.y,0,J.z,Q.z,$.z,0,0,0,0,1),this}extractRotation(J){if(J.determinantAffine()===0)return this.identity();let Q=this.elements,$=J.elements,Z=1/G9.setFromMatrixColumn(J,0).length(),W=1/G9.setFromMatrixColumn(J,1).length(),q=1/G9.setFromMatrixColumn(J,2).length();return Q[0]=$[0]*Z,Q[1]=$[1]*Z,Q[2]=$[2]*Z,Q[3]=0,Q[4]=$[4]*W,Q[5]=$[5]*W,Q[6]=$[6]*W,Q[7]=0,Q[8]=$[8]*q,Q[9]=$[9]*q,Q[10]=$[10]*q,Q[11]=0,Q[12]=0,Q[13]=0,Q[14]=0,Q[15]=1,this}makeRotationFromEuler(J){let Q=this.elements,$=J.x,Z=J.y,W=J.z,q=Math.cos($),K=Math.sin($),H=Math.cos(Z),U=Math.sin(Z),Y=Math.cos(W),X=Math.sin(W);if(J.order==="XYZ"){let G=q*Y,N=q*X,F=K*Y,M=K*X;Q[0]=H*Y,Q[4]=-H*X,Q[8]=U,Q[1]=N+F*U,Q[5]=G-M*U,Q[9]=-K*H,Q[2]=M-G*U,Q[6]=F+N*U,Q[10]=q*H}else if(J.order==="YXZ"){let G=H*Y,N=H*X,F=U*Y,M=U*X;Q[0]=G+M*K,Q[4]=F*K-N,Q[8]=q*U,Q[1]=q*X,Q[5]=q*Y,Q[9]=-K,Q[2]=N*K-F,Q[6]=M+G*K,Q[10]=q*H}else if(J.order==="ZXY"){let G=H*Y,N=H*X,F=U*Y,M=U*X;Q[0]=G-M*K,Q[4]=-q*X,Q[8]=F+N*K,Q[1]=N+F*K,Q[5]=q*Y,Q[9]=M-G*K,Q[2]=-q*U,Q[6]=K,Q[10]=q*H}else if(J.order==="ZYX"){let G=q*Y,N=q*X,F=K*Y,M=K*X;Q[0]=H*Y,Q[4]=F*U-N,Q[8]=G*U+M,Q[1]=H*X,Q[5]=M*U+G,Q[9]=N*U-F,Q[2]=-U,Q[6]=K*H,Q[10]=q*H}else if(J.order==="YZX"){let G=q*H,N=q*U,F=K*H,M=K*U;Q[0]=H*Y,Q[4]=M-G*X,Q[8]=F*X+N,Q[1]=X,Q[5]=q*Y,Q[9]=-K*Y,Q[2]=-U*Y,Q[6]=N*X+F,Q[10]=G-M*X}else if(J.order==="XZY"){let G=q*H,N=q*U,F=K*H,M=K*U;Q[0]=H*Y,Q[4]=-X,Q[8]=U*Y,Q[1]=G*X+M,Q[5]=q*Y,Q[9]=N*X-F,Q[2]=F*X-N,Q[6]=K*Y,Q[10]=M*X+G}return Q[3]=0,Q[7]=0,Q[11]=0,Q[12]=0,Q[13]=0,Q[14]=0,Q[15]=1,this}makeRotationFromQuaternion(J){return this.compose(BW,J,zW)}lookAt(J,Q,$){let Z=this.elements;if(g6.subVectors(J,Q),g6.lengthSq()===0)g6.z=1;if(g6.normalize(),w7.crossVectors($,g6),w7.lengthSq()===0){if(Math.abs($.z)===1)g6.x+=0.0001;else g6.z+=0.0001;g6.normalize(),w7.crossVectors($,g6)}return w7.normalize(),C0.crossVectors(g6,w7),Z[0]=w7.x,Z[4]=C0.x,Z[8]=g6.x,Z[1]=w7.y,Z[5]=C0.y,Z[9]=g6.y,Z[2]=w7.z,Z[6]=C0.z,Z[10]=g6.z,this}multiply(J){return this.multiplyMatrices(this,J)}premultiply(J){return this.multiplyMatrices(J,this)}multiplyMatrices(J,Q){let $=J.elements,Z=Q.elements,W=this.elements,q=$[0],K=$[4],H=$[8],U=$[12],Y=$[1],X=$[5],G=$[9],N=$[13],F=$[2],M=$[6],L=$[10],E=$[14],O=$[3],_=$[7],V=$[11],B=$[15],w=Z[0],y=Z[4],D=Z[8],z=Z[12],m=Z[1],t=Z[5],v=Z[9],J8=Z[13],E8=Z[2],T=Z[6],H8=Z[10],e=Z[14],S=Z[3],B8=Z[7],i=Z[11],X8=Z[15];return W[0]=q*w+K*m+H*E8+U*S,W[4]=q*y+K*t+H*T+U*B8,W[8]=q*D+K*v+H*H8+U*i,W[12]=q*z+K*J8+H*e+U*X8,W[1]=Y*w+X*m+G*E8+N*S,W[5]=Y*y+X*t+G*T+N*B8,W[9]=Y*D+X*v+G*H8+N*i,W[13]=Y*z+X*J8+G*e+N*X8,W[2]=F*w+M*m+L*E8+E*S,W[6]=F*y+M*t+L*T+E*B8,W[10]=F*D+M*v+L*H8+E*i,W[14]=F*z+M*J8+L*e+E*X8,W[3]=O*w+_*m+V*E8+B*S,W[7]=O*y+_*t+V*T+B*B8,W[11]=O*D+_*v+V*H8+B*i,W[15]=O*z+_*J8+V*e+B*X8,this}multiplyScalar(J){let Q=this.elements;return Q[0]*=J,Q[4]*=J,Q[8]*=J,Q[12]*=J,Q[1]*=J,Q[5]*=J,Q[9]*=J,Q[13]*=J,Q[2]*=J,Q[6]*=J,Q[10]*=J,Q[14]*=J,Q[3]*=J,Q[7]*=J,Q[11]*=J,Q[15]*=J,this}determinant(){let J=this.elements,Q=J[0],$=J[4],Z=J[8],W=J[12],q=J[1],K=J[5],H=J[9],U=J[13],Y=J[2],X=J[6],G=J[10],N=J[14],F=J[3],M=J[7],L=J[11],E=J[15],O=H*N-U*G,_=K*N-U*X,V=K*G-H*X,B=q*N-U*Y,w=q*G-H*Y,y=q*X-K*Y;return Q*(M*O-L*_+E*V)-$*(F*O-L*B+E*w)+Z*(F*_-M*B+E*y)-W*(F*V-M*w+L*y)}determinantAffine(){let J=this.elements,Q=J[0],$=J[4],Z=J[8],W=J[1],q=J[5],K=J[9],H=J[2],U=J[6],Y=J[10];return Q*(q*Y-K*U)-$*(W*Y-K*H)+Z*(W*U-q*H)}transpose(){let J=this.elements,Q;return Q=J[1],J[1]=J[4],J[4]=Q,Q=J[2],J[2]=J[8],J[8]=Q,Q=J[6],J[6]=J[9],J[9]=Q,Q=J[3],J[3]=J[12],J[12]=Q,Q=J[7],J[7]=J[13],J[13]=Q,Q=J[11],J[11]=J[14],J[14]=Q,this}setPosition(J,Q,$){let Z=this.elements;if(J.isVector3)Z[12]=J.x,Z[13]=J.y,Z[14]=J.z;else Z[12]=J,Z[13]=Q,Z[14]=$;return this}invert(){let J=this.elements,Q=J[0],$=J[1],Z=J[2],W=J[3],q=J[4],K=J[5],H=J[6],U=J[7],Y=J[8],X=J[9],G=J[10],N=J[11],F=J[12],M=J[13],L=J[14],E=J[15],O=Q*K-$*q,_=Q*H-Z*q,V=Q*U-W*q,B=$*H-Z*K,w=$*U-W*K,y=Z*U-W*H,D=Y*M-X*F,z=Y*L-G*F,m=Y*E-N*F,t=X*L-G*M,v=X*E-N*M,J8=G*E-N*L,E8=O*J8-_*v+V*t+B*m-w*z+y*D;if(E8===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let T=1/E8;return J[0]=(K*J8-H*v+U*t)*T,J[1]=(Z*v-$*J8-W*t)*T,J[2]=(M*y-L*w+E*B)*T,J[3]=(G*w-X*y-N*B)*T,J[4]=(H*m-q*J8-U*z)*T,J[5]=(Q*J8-Z*m+W*z)*T,J[6]=(L*V-F*y-E*_)*T,J[7]=(Y*y-G*V+N*_)*T,J[8]=(q*v-K*m+U*D)*T,J[9]=($*m-Q*v-W*D)*T,J[10]=(F*w-M*V+E*O)*T,J[11]=(X*V-Y*w-N*O)*T,J[12]=(K*z-q*t-H*D)*T,J[13]=(Q*t-$*z+Z*D)*T,J[14]=(M*_-F*B-L*O)*T,J[15]=(Y*B-X*_+G*O)*T,this}scale(J){let Q=this.elements,$=J.x,Z=J.y,W=J.z;return Q[0]*=$,Q[4]*=Z,Q[8]*=W,Q[1]*=$,Q[5]*=Z,Q[9]*=W,Q[2]*=$,Q[6]*=Z,Q[10]*=W,Q[3]*=$,Q[7]*=Z,Q[11]*=W,this}getMaxScaleOnAxis(){let J=this.elements,Q=J[0]*J[0]+J[1]*J[1]+J[2]*J[2],$=J[4]*J[4]+J[5]*J[5]+J[6]*J[6],Z=J[8]*J[8]+J[9]*J[9]+J[10]*J[10];return Math.sqrt(Math.max(Q,$,Z))}makeTranslation(J,Q,$){if(J.isVector3)this.set(1,0,0,J.x,0,1,0,J.y,0,0,1,J.z,0,0,0,1);else this.set(1,0,0,J,0,1,0,Q,0,0,1,$,0,0,0,1);return this}makeRotationX(J){let Q=Math.cos(J),$=Math.sin(J);return this.set(1,0,0,0,0,Q,-$,0,0,$,Q,0,0,0,0,1),this}makeRotationY(J){let Q=Math.cos(J),$=Math.sin(J);return this.set(Q,0,$,0,0,1,0,0,-$,0,Q,0,0,0,0,1),this}makeRotationZ(J){let Q=Math.cos(J),$=Math.sin(J);return this.set(Q,-$,0,0,$,Q,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(J,Q){let $=Math.cos(Q),Z=Math.sin(Q),W=1-$,q=J.x,K=J.y,H=J.z,U=W*q,Y=W*K;return this.set(U*q+$,U*K-Z*H,U*H+Z*K,0,U*K+Z*H,Y*K+$,Y*H-Z*q,0,U*H-Z*K,Y*H+Z*q,W*H*H+$,0,0,0,0,1),this}makeScale(J,Q,$){return this.set(J,0,0,0,0,Q,0,0,0,0,$,0,0,0,0,1),this}makeShear(J,Q,$,Z,W,q){return this.set(1,$,W,0,J,1,q,0,Q,Z,1,0,0,0,0,1),this}compose(J,Q,$){let Z=this.elements,W=Q._x,q=Q._y,K=Q._z,H=Q._w,U=W+W,Y=q+q,X=K+K,G=W*U,N=W*Y,F=W*X,M=q*Y,L=q*X,E=K*X,O=H*U,_=H*Y,V=H*X,B=$.x,w=$.y,y=$.z;return Z[0]=(1-(M+E))*B,Z[1]=(N+V)*B,Z[2]=(F-_)*B,Z[3]=0,Z[4]=(N-V)*w,Z[5]=(1-(G+E))*w,Z[6]=(L+O)*w,Z[7]=0,Z[8]=(F+_)*y,Z[9]=(L-O)*y,Z[10]=(1-(G+M))*y,Z[11]=0,Z[12]=J.x,Z[13]=J.y,Z[14]=J.z,Z[15]=1,this}decompose(J,Q,$){let Z=this.elements;J.x=Z[12],J.y=Z[13],J.z=Z[14];let W=this.determinantAffine();if(W===0)return $.set(1,1,1),Q.identity(),this;let q=G9.set(Z[0],Z[1],Z[2]).length(),K=G9.set(Z[4],Z[5],Z[6]).length(),H=G9.set(Z[8],Z[9],Z[10]).length();if(W<0)q=-q;a6.copy(this);let U=1/q,Y=1/K,X=1/H;return a6.elements[0]*=U,a6.elements[1]*=U,a6.elements[2]*=U,a6.elements[4]*=Y,a6.elements[5]*=Y,a6.elements[6]*=Y,a6.elements[8]*=X,a6.elements[9]*=X,a6.elements[10]*=X,Q.setFromRotationMatrix(a6),$.x=q,$.y=K,$.z=H,this}makePerspective(J,Q,$,Z,W,q,K=2000,H=!1){let U=this.elements,Y=2*W/(Q-J),X=2*W/($-Z),G=(Q+J)/(Q-J),N=($+Z)/($-Z),F,M;if(H)F=W/(q-W),M=q*W/(q-W);else if(K===2000)F=-(q+W)/(q-W),M=-2*q*W/(q-W);else if(K===2001)F=-q/(q-W),M=-q*W/(q-W);else throw Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+K);return U[0]=Y,U[4]=0,U[8]=G,U[12]=0,U[1]=0,U[5]=X,U[9]=N,U[13]=0,U[2]=0,U[6]=0,U[10]=F,U[14]=M,U[3]=0,U[7]=0,U[11]=-1,U[15]=0,this}makeOrthographic(J,Q,$,Z,W,q,K=2000,H=!1){let U=this.elements,Y=2/(Q-J),X=2/($-Z),G=-(Q+J)/(Q-J),N=-($+Z)/($-Z),F,M;if(H)F=1/(q-W),M=q/(q-W);else if(K===2000)F=-2/(q-W),M=-(q+W)/(q-W);else if(K===2001)F=-1/(q-W),M=-W/(q-W);else throw Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+K);return U[0]=Y,U[4]=0,U[8]=0,U[12]=G,U[1]=0,U[5]=X,U[9]=0,U[13]=N,U[2]=0,U[6]=0,U[10]=F,U[14]=M,U[3]=0,U[7]=0,U[11]=0,U[15]=1,this}equals(J){let Q=this.elements,$=J.elements;for(let Z=0;Z<16;Z++)if(Q[Z]!==$[Z])return!1;return!0}fromArray(J,Q=0){for(let $=0;$<16;$++)this.elements[$]=J[$+Q];return this}toArray(J=[],Q=0){let $=this.elements;return J[Q]=$[0],J[Q+1]=$[1],J[Q+2]=$[2],J[Q+3]=$[3],J[Q+4]=$[4],J[Q+5]=$[5],J[Q+6]=$[6],J[Q+7]=$[7],J[Q+8]=$[8],J[Q+9]=$[9],J[Q+10]=$[10],J[Q+11]=$[11],J[Q+12]=$[12],J[Q+13]=$[13],J[Q+14]=$[14],J[Q+15]=$[15],J}}var G9=new u,a6=new G6,BW=new u(0,0,0),zW=new u(1,1,1),w7=new u,C0=new u,g6=new u,DQ=new G6,OQ=new _7;class Y7{constructor(J=0,Q=0,$=0,Z=Y7.DEFAULT_ORDER){this.isEuler=!0,this._x=J,this._y=Q,this._z=$,this._order=Z}get x(){return this._x}set x(J){this._x=J,this._onChangeCallback()}get y(){return this._y}set y(J){this._y=J,this._onChangeCallback()}get z(){return this._z}set z(J){this._z=J,this._onChangeCallback()}get order(){return this._order}set order(J){this._order=J,this._onChangeCallback()}set(J,Q,$,Z=this._order){return this._x=J,this._y=Q,this._z=$,this._order=Z,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(J){return this._x=J._x,this._y=J._y,this._z=J._z,this._order=J._order,this._onChangeCallback(),this}setFromRotationMatrix(J,Q=this._order,$=!0){let Z=J.elements,W=Z[0],q=Z[4],K=Z[8],H=Z[1],U=Z[5],Y=Z[9],X=Z[2],G=Z[6],N=Z[10];switch(Q){case"XYZ":if(this._y=Math.asin(Z6(K,-1,1)),Math.abs(K)<0.9999999)this._x=Math.atan2(-Y,N),this._z=Math.atan2(-q,W);else this._x=Math.atan2(G,U),this._z=0;break;case"YXZ":if(this._x=Math.asin(-Z6(Y,-1,1)),Math.abs(Y)<0.9999999)this._y=Math.atan2(K,N),this._z=Math.atan2(H,U);else this._y=Math.atan2(-X,W),this._z=0;break;case"ZXY":if(this._x=Math.asin(Z6(G,-1,1)),Math.abs(G)<0.9999999)this._y=Math.atan2(-X,N),this._z=Math.atan2(-q,U);else this._y=0,this._z=Math.atan2(H,W);break;case"ZYX":if(this._y=Math.asin(-Z6(X,-1,1)),Math.abs(X)<0.9999999)this._x=Math.atan2(G,N),this._z=Math.atan2(H,W);else this._x=0,this._z=Math.atan2(-q,U);break;case"YZX":if(this._z=Math.asin(Z6(H,-1,1)),Math.abs(H)<0.9999999)this._x=Math.atan2(-Y,U),this._y=Math.atan2(-X,W);else this._x=0,this._y=Math.atan2(K,N);break;case"XZY":if(this._z=Math.asin(-Z6(q,-1,1)),Math.abs(q)<0.9999999)this._x=Math.atan2(G,U),this._y=Math.atan2(K,W);else this._x=Math.atan2(-Y,N),this._y=0;break;default:t8("Euler: .setFromRotationMatrix() encountered an unknown order: "+Q)}if(this._order=Q,$===!0)this._onChangeCallback();return this}setFromQuaternion(J,Q,$){return DQ.makeRotationFromQuaternion(J),this.setFromRotationMatrix(DQ,Q,$)}setFromVector3(J,Q=this._order){return this.set(J.x,J.y,J.z,Q)}reorder(J){return OQ.setFromEuler(this),this.setFromQuaternion(OQ,J)}equals(J){return J._x===this._x&&J._y===this._y&&J._z===this._z&&J._order===this._order}fromArray(J){if(this._x=J[0],this._y=J[1],this._z=J[2],J[3]!==void 0)this._order=J[3];return this._onChangeCallback(),this}toArray(J=[],Q=0){return J[Q]=this._x,J[Q+1]=this._y,J[Q+2]=this._z,J[Q+3]=this._order,J}_onChange(J){return this._onChangeCallback=J,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}Y7.DEFAULT_ORDER="XYZ";class X5{constructor(){this.mask=1}set(J){this.mask=(1<<J|0)>>>0}enable(J){this.mask|=1<<J|0}enableAll(){this.mask=-1}toggle(J){this.mask^=1<<J|0}disable(J){this.mask&=~(1<<J|0)}disableAll(){this.mask=0}test(J){return(this.mask&J.mask)!==0}isEnabled(J){return(this.mask&(1<<J|0))!==0}}var VW=0,RQ=new u,N9=new _7,O7=new G6,P0=new u,u9=new u,IW=new u,AW=new _7,MQ=new u(1,0,0),kQ=new u(0,1,0),LQ=new u(0,0,1),BQ={type:"added"},_W={type:"removed"},E9={type:"childadded",child:null},n5={type:"childremoved",child:null};class z6 extends A7{constructor(){super();this.isObject3D=!0,Object.defineProperty(this,"id",{value:VW++}),this.uuid=J9(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=z6.DEFAULT_UP.clone();let J=new u,Q=new Y7,$=new _7,Z=new u(1,1,1);function W(){$.setFromEuler(Q,!1)}function q(){Q.setFromQuaternion($,void 0,!1)}Q._onChange(W),$._onChange(q),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:J},rotation:{configurable:!0,enumerable:!0,value:Q},quaternion:{configurable:!0,enumerable:!0,value:$},scale:{configurable:!0,enumerable:!0,value:Z},modelViewMatrix:{value:new G6},normalMatrix:{value:new i8}}),this.matrix=new G6,this.matrixWorld=new G6,this.matrixAutoUpdate=z6.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=z6.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new X5,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.static=!1,this.userData={},this.pivot=null}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(J){if(this.matrixAutoUpdate)this.updateMatrix();if(this.matrix.premultiply(J),this.matrix.decompose(this.position,this.quaternion,this.scale),this.pivot!==null)this.position.copy(this.pivot).applyMatrix4(this.matrix).sub(this.pivot)}applyQuaternion(J){return this.quaternion.premultiply(J),this}setRotationFromAxisAngle(J,Q){this.quaternion.setFromAxisAngle(J,Q)}setRotationFromEuler(J){this.quaternion.setFromEuler(J,!0)}setRotationFromMatrix(J){this.quaternion.setFromRotationMatrix(J)}setRotationFromQuaternion(J){this.quaternion.copy(J)}rotateOnAxis(J,Q){return N9.setFromAxisAngle(J,Q),this.quaternion.multiply(N9),this}rotateOnWorldAxis(J,Q){return N9.setFromAxisAngle(J,Q),this.quaternion.premultiply(N9),this}rotateX(J){return this.rotateOnAxis(MQ,J)}rotateY(J){return this.rotateOnAxis(kQ,J)}rotateZ(J){return this.rotateOnAxis(LQ,J)}translateOnAxis(J,Q){return RQ.copy(J).applyQuaternion(this.quaternion),this.position.add(RQ.multiplyScalar(Q)),this}translateX(J){return this.translateOnAxis(MQ,J)}translateY(J){return this.translateOnAxis(kQ,J)}translateZ(J){return this.translateOnAxis(LQ,J)}localToWorld(J){return this.updateWorldMatrix(!0,!1),J.applyMatrix4(this.matrixWorld)}worldToLocal(J){return this.updateWorldMatrix(!0,!1),J.applyMatrix4(O7.copy(this.matrixWorld).invert())}lookAt(J,Q,$){if(J.isVector3)P0.copy(J);else P0.set(J,Q,$);let Z=this.parent;if(this.updateWorldMatrix(!0,!1),u9.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight)O7.lookAt(u9,P0,this.up);else O7.lookAt(P0,u9,this.up);if(this.quaternion.setFromRotationMatrix(O7),Z)O7.extractRotation(Z.matrixWorld),N9.setFromRotationMatrix(O7),this.quaternion.premultiply(N9.invert())}add(J){if(arguments.length>1){for(let Q=0;Q<arguments.length;Q++)this.add(arguments[Q]);return this}if(J===this)return e8("Object3D.add: object can't be added as a child of itself.",J),this;if(J&&J.isObject3D)J.removeFromParent(),J.parent=this,this.children.push(J),J.dispatchEvent(BQ),E9.child=J,this.dispatchEvent(E9),E9.child=null;else e8("Object3D.add: object not an instance of THREE.Object3D.",J);return this}remove(J){if(arguments.length>1){for(let $=0;$<arguments.length;$++)this.remove(arguments[$]);return this}let Q=this.children.indexOf(J);if(Q!==-1)J.parent=null,this.children.splice(Q,1),J.dispatchEvent(_W),n5.child=J,this.dispatchEvent(n5),n5.child=null;return this}removeFromParent(){let J=this.parent;if(J!==null)J.remove(this);return this}clear(){return this.remove(...this.children)}attach(J){if(this.updateWorldMatrix(!0,!1),O7.copy(this.matrixWorld).invert(),J.parent!==null)J.parent.updateWorldMatrix(!0,!1),O7.multiply(J.parent.matrixWorld);return J.applyMatrix4(O7),J.removeFromParent(),J.parent=this,this.children.push(J),J.updateWorldMatrix(!1,!0),J.dispatchEvent(BQ),E9.child=J,this.dispatchEvent(E9),E9.child=null,this}getObjectById(J){return this.getObjectByProperty("id",J)}getObjectByName(J){return this.getObjectByProperty("name",J)}getObjectByProperty(J,Q){if(this[J]===Q)return this;for(let $=0,Z=this.children.length;$<Z;$++){let q=this.children[$].getObjectByProperty(J,Q);if(q!==void 0)return q}return}getObjectsByProperty(J,Q,$=[]){if(this[J]===Q)$.push(this);let Z=this.children;for(let W=0,q=Z.length;W<q;W++)Z[W].getObjectsByProperty(J,Q,$);return $}getWorldPosition(J){return this.updateWorldMatrix(!0,!1),J.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(J){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(u9,J,IW),J}getWorldScale(J){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(u9,AW,J),J}getWorldDirection(J){this.updateWorldMatrix(!0,!1);let Q=this.matrixWorld.elements;return J.set(Q[8],Q[9],Q[10]).normalize()}raycast(){}intersectsFrustum(){return!0}traverse(J){J(this);let Q=this.children;for(let $=0,Z=Q.length;$<Z;$++)Q[$].traverse(J)}traverseVisible(J){if(this.visible===!1)return;J(this);let Q=this.children;for(let $=0,Z=Q.length;$<Z;$++)Q[$].traverseVisible(J)}traverseAncestors(J){let Q=this.parent;if(Q!==null)J(Q),Q.traverseAncestors(J)}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale);let J=this.pivot;if(J!==null){let{x:Q,y:$,z:Z}=J,W=this.matrix.elements;W[12]+=Q-W[0]*Q-W[4]*$-W[8]*Z,W[13]+=$-W[1]*Q-W[5]*$-W[9]*Z,W[14]+=Z-W[2]*Q-W[6]*$-W[10]*Z}this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(J){if(this.matrixAutoUpdate)this.updateMatrix();if(this.matrixWorldNeedsUpdate||J){if(this.matrixWorldAutoUpdate===!0)if(this.parent===null)this.matrixWorld.copy(this.matrix);else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix);this.matrixWorldNeedsUpdate=!1,J=!0}let Q=this.children;for(let $=0,Z=Q.length;$<Z;$++)Q[$].updateMatrixWorld(J)}updateWorldMatrix(J,Q,$=!1){let Z=this.parent;if(J===!0&&Z!==null)Z.updateWorldMatrix(!0,!1);if(this.matrixAutoUpdate)this.updateMatrix();if(this.matrixWorldNeedsUpdate||$){if(this.matrixWorldAutoUpdate===!0)if(this.parent===null)this.matrixWorld.copy(this.matrix);else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix);this.matrixWorldNeedsUpdate=!1,$=!0}if(Q===!0){let W=this.children;for(let q=0,K=W.length;q<K;q++)W[q].updateWorldMatrix(!1,!0,$)}}toJSON(J){let Q=J===void 0||typeof J==="string",$={};if(Q)J={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},$.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"};let Z={};if(Z.uuid=this.uuid,Z.type=this.type,Z.name=this.name,Z.castShadow=this.castShadow,Z.receiveShadow=this.receiveShadow,Z.visible=this.visible,Z.frustumCulled=this.frustumCulled,Z.renderOrder=this.renderOrder,Z.static=this.static,Z.matrixAutoUpdate=this.matrixAutoUpdate,Object.keys(this.userData).length>0)Z.userData=this.userData;if(Z.layers=this.layers.mask,Z.matrix=this.matrix.toArray(),Z.up=this.up.toArray(),this.pivot!==null)Z.pivot=this.pivot.toArray();if(this.morphTargetDictionary!==void 0)Z.morphTargetDictionary=Object.assign({},this.morphTargetDictionary);if(this.morphTargetInfluences!==void 0)Z.morphTargetInfluences=this.morphTargetInfluences.slice();if(this.isInstancedMesh){if(Z.type="InstancedMesh",Z.count=this.count,Z.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null)Z.instanceColor=this.instanceColor.toJSON()}if(this.isBatchedMesh){if(Z.type="BatchedMesh",Z.perObjectFrustumCulled=this.perObjectFrustumCulled,Z.sortObjects=this.sortObjects,Z.drawRanges=this._drawRanges,Z.reservedRanges=this._reservedRanges,Z.geometryInfo=this._geometryInfo.map((K)=>({...K,boundingBox:K.boundingBox?K.boundingBox.toJSON():void 0,boundingSphere:K.boundingSphere?K.boundingSphere.toJSON():void 0})),Z.instanceInfo=this._instanceInfo.map((K)=>({...K})),Z.availableInstanceIds=this._availableInstanceIds.slice(),Z.availableGeometryIds=this._availableGeometryIds.slice(),Z.nextIndexStart=this._nextIndexStart,Z.nextVertexStart=this._nextVertexStart,Z.geometryCount=this._geometryCount,Z.maxInstanceCount=this._maxInstanceCount,Z.maxVertexCount=this._maxVertexCount,Z.maxIndexCount=this._maxIndexCount,Z.geometryInitialized=this._geometryInitialized,Z.matricesTexture=this._matricesTexture.toJSON(J),Z.indirectTexture=this._indirectTexture.toJSON(J),this._colorsTexture!==null)Z.colorsTexture=this._colorsTexture.toJSON(J);if(this.boundingSphere!==null)Z.boundingSphere=this.boundingSphere.toJSON();if(this.boundingBox!==null)Z.boundingBox=this.boundingBox.toJSON()}function W(K,H){if(K[H.uuid]===void 0)K[H.uuid]=H.toJSON(J);return H.uuid}if(this.isScene){if(this.background){if(this.background.isColor)Z.background=this.background.toJSON();else if(this.background.isTexture)Z.background=this.background.toJSON(J).uuid}if(this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0)Z.environment=this.environment.toJSON(J).uuid}else if(this.isMesh||this.isLine||this.isPoints){Z.geometry=W(J.geometries,this.geometry);let K=this.geometry.parameters;if(K!==void 0&&K.shapes!==void 0){let H=K.shapes;if(Array.isArray(H))for(let U=0,Y=H.length;U<Y;U++){let X=H[U];W(J.shapes,X)}else W(J.shapes,H)}}if(this.isSkinnedMesh){if(Z.bindMode=this.bindMode,Z.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0)W(J.skeletons,this.skeleton),Z.skeleton=this.skeleton.uuid}if(this.material!==void 0)if(Array.isArray(this.material)){let K=[];for(let H=0,U=this.material.length;H<U;H++)K.push(W(J.materials,this.material[H]));Z.material=K}else Z.material=W(J.materials,this.material);if(this.children.length>0){Z.children=[];for(let K=0;K<this.children.length;K++)Z.children.push(this.children[K].toJSON(J).object)}if(this.animations.length>0){Z.animations=[];for(let K=0;K<this.animations.length;K++){let H=this.animations[K];Z.animations.push(W(J.animations,H))}}if(Q){let K=q(J.geometries),H=q(J.materials),U=q(J.textures),Y=q(J.images),X=q(J.shapes),G=q(J.skeletons),N=q(J.animations),F=q(J.nodes);if(K.length>0)$.geometries=K;if(H.length>0)$.materials=H;if(U.length>0)$.textures=U;if(Y.length>0)$.images=Y;if(X.length>0)$.shapes=X;if(G.length>0)$.skeletons=G;if(N.length>0)$.animations=N;if(F.length>0)$.nodes=F}return $.object=Z,$;function q(K){let H=[];for(let U in K){let Y=K[U];delete Y.metadata,H.push(Y)}return H}}clone(J){return new this.constructor().copy(this,J)}copy(J,Q=!0){if(this.name=J.name,this.up.copy(J.up),this.position.copy(J.position),this.rotation.order=J.rotation.order,this.quaternion.copy(J.quaternion),this.scale.copy(J.scale),this.pivot=J.pivot!==null?J.pivot.clone():null,this.matrix.copy(J.matrix),this.matrixWorld.copy(J.matrixWorld),this.matrixAutoUpdate=J.matrixAutoUpdate,this.matrixWorldAutoUpdate=J.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=J.matrixWorldNeedsUpdate,this.layers.mask=J.layers.mask,this.visible=J.visible,this.castShadow=J.castShadow,this.receiveShadow=J.receiveShadow,this.frustumCulled=J.frustumCulled,this.renderOrder=J.renderOrder,this.static=J.static,this.animations=J.animations.slice(),this.userData=JSON.parse(JSON.stringify(J.userData)),Q===!0)for(let $=0;$<J.children.length;$++){let Z=J.children[$];this.add(Z.clone())}return this}dispose(){this.dispatchEvent({type:"dispose"})}}z6.DEFAULT_UP=new u(0,1,0);z6.DEFAULT_MATRIX_AUTO_UPDATE=!0;z6.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;class K7 extends z6{constructor(){super();this.isGroup=!0,this.type="Group"}}var CW={type:"move"};class N0{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){if(this._hand===null)this._hand=new K7,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1};return this._hand}getTargetRaySpace(){if(this._targetRay===null)this._targetRay=new K7,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new u,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new u;return this._targetRay}getGripSpace(){if(this._grip===null)this._grip=new K7,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new u,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new u,this._grip.eventsEnabled=!1;return this._grip}dispatchEvent(J){if(this._targetRay!==null)this._targetRay.dispatchEvent(J);if(this._grip!==null)this._grip.dispatchEvent(J);if(this._hand!==null)this._hand.dispatchEvent(J);return this}connect(J){if(J&&J.hand){let Q=this._hand;if(Q)for(let $ of J.hand.values())this._getHandJoint(Q,$)}return this.dispatchEvent({type:"connected",data:J}),this}disconnect(J){if(this.dispatchEvent({type:"disconnected",data:J}),this._targetRay!==null)this._targetRay.visible=!1;if(this._grip!==null)this._grip.visible=!1;if(this._hand!==null)this._hand.visible=!1;return this}update(J,Q,$){let Z=null,W=null,q=null,K=this._targetRay,H=this._grip,U=this._hand;if(J&&Q.session.visibilityState!=="visible-blurred"){if(U&&J.hand){q=!0;for(let M of J.hand.values()){let L=Q.getJointPose(M,$),E=this._getHandJoint(U,M);if(L!==null)E.matrix.fromArray(L.transform.matrix),E.matrix.decompose(E.position,E.quaternion,E.scale),E.matrixWorldNeedsUpdate=!0,E.jointRadius=L.radius;E.visible=L!==null}let Y=U.joints["index-finger-tip"],X=U.joints["thumb-tip"],G=Y.position.distanceTo(X.position),N=0.02,F=0.005;if(U.inputState.pinching&&G>N+F)U.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:J.handedness,target:this});else if(!U.inputState.pinching&&G<=N-F)U.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:J.handedness,target:this})}else if(H!==null&&J.gripSpace){if(W=Q.getPose(J.gripSpace,$),W!==null){if(H.matrix.fromArray(W.transform.matrix),H.matrix.decompose(H.position,H.quaternion,H.scale),H.matrixWorldNeedsUpdate=!0,W.linearVelocity)H.hasLinearVelocity=!0,H.linearVelocity.copy(W.linearVelocity);else H.hasLinearVelocity=!1;if(W.angularVelocity)H.hasAngularVelocity=!0,H.angularVelocity.copy(W.angularVelocity);else H.hasAngularVelocity=!1;if(H.eventsEnabled)H.dispatchEvent({type:"gripUpdated",data:J,target:this})}}if(K!==null){if(Z=Q.getPose(J.targetRaySpace,$),Z===null&&W!==null)Z=W;if(Z!==null){if(K.matrix.fromArray(Z.transform.matrix),K.matrix.decompose(K.position,K.quaternion,K.scale),K.matrixWorldNeedsUpdate=!0,Z.linearVelocity)K.hasLinearVelocity=!0,K.linearVelocity.copy(Z.linearVelocity);else K.hasLinearVelocity=!1;if(Z.angularVelocity)K.hasAngularVelocity=!0,K.angularVelocity.copy(Z.angularVelocity);else K.hasAngularVelocity=!1;this.dispatchEvent(CW)}}}if(K!==null)K.visible=Z!==null;if(H!==null)H.visible=W!==null;if(U!==null)U.visible=q!==null;return this}_getHandJoint(J,Q){if(J.joints[Q.jointName]===void 0){let $=new K7;$.matrixAutoUpdate=!1,$.visible=!1,J.joints[Q.jointName]=$,J.add($)}return J.joints[Q.jointName]}}var u$={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},T7={h:0,s:0,l:0},w0={h:0,s:0,l:0};function s5(J,Q,$){if($<0)$+=1;if($>1)$-=1;if($<0.16666666666666666)return J+(Q-J)*6*$;if($<0.5)return Q;if($<0.6666666666666666)return J+(Q-J)*6*(0.6666666666666666-$);return J}class r8{constructor(J,Q,$){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(J,Q,$)}set(J,Q,$){if(Q===void 0&&$===void 0){let Z=J;if(Z&&Z.isColor)this.copy(Z);else if(typeof Z==="number")this.setHex(Z);else if(typeof Z==="string")this.setStyle(Z)}else this.setRGB(J,Q,$);return this}setScalar(J){return this.r=J,this.g=J,this.b=J,this}setHex(J,Q="srgb"){return J=Math.floor(J),this.r=(J>>16&255)/255,this.g=(J>>8&255)/255,this.b=(J&255)/255,K6.colorSpaceToWorking(this,Q),this}setRGB(J,Q,$,Z=K6.workingColorSpace){return this.r=J,this.g=Q,this.b=$,K6.colorSpaceToWorking(this,Z),this}setHSL(J,Q,$,Z=K6.workingColorSpace){if(J=RJ(J,1),Q=Z6(Q,0,1),$=Z6($,0,1),Q===0)this.r=this.g=this.b=$;else{let W=$<=0.5?$*(1+Q):$+Q-$*Q,q=2*$-W;this.r=s5(q,W,J+0.3333333333333333),this.g=s5(q,W,J),this.b=s5(q,W,J-0.3333333333333333)}return K6.colorSpaceToWorking(this,Z),this}setStyle(J,Q="srgb"){function $(W){if(W===void 0)return;if(parseFloat(W)<1)t8("Color: Alpha component of "+J+" will be ignored.")}let Z;if(Z=/^(\w+)\(([^\)]*)\)/.exec(J)){let W,q=Z[1],K=Z[2];switch(q){case"rgb":case"rgba":if(W=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(K))return $(W[4]),this.setRGB(Math.min(255,parseInt(W[1],10))/255,Math.min(255,parseInt(W[2],10))/255,Math.min(255,parseInt(W[3],10))/255,Q);if(W=/^\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(K))return $(W[4]),this.setRGB(Math.min(100,parseFloat(W[1]))/100,Math.min(100,parseFloat(W[2]))/100,Math.min(100,parseFloat(W[3]))/100,Q);break;case"hsl":case"hsla":if(W=/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*,\s*(\d+(?:\.\d+)?|\.\d+)\%\s*(?:,\s*(\d+(?:\.\d+)?|\.\d+)\s*)?$/.exec(K))return $(W[4]),this.setHSL(parseFloat(W[1])/360,parseFloat(W[2])/100,parseFloat(W[3])/100,Q);break;default:t8("Color: Unknown color model "+J)}}else if(Z=/^\#([A-Fa-f\d]+)$/.exec(J)){let W=Z[1],q=W.length;if(q===3)return this.setRGB(parseInt(W.charAt(0),16)/15,parseInt(W.charAt(1),16)/15,parseInt(W.charAt(2),16)/15,Q);else if(q===6)return this.setHex(parseInt(W,16),Q);else t8("Color: Invalid hex color "+J)}else if(J&&J.length>0)return this.setColorName(J,Q);return this}setColorName(J,Q="srgb"){let $=u$[J.toLowerCase()];if($!==void 0)this.setHex($,Q);else t8("Color: Unknown color "+J);return this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(J){return this.r=J.r,this.g=J.g,this.b=J.b,this}copySRGBToLinear(J){return this.r=z7(J.r),this.g=z7(J.g),this.b=z7(J.b),this}copyLinearToSRGB(J){return this.r=I9(J.r),this.g=I9(J.g),this.b=I9(J.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(J="srgb"){return K6.workingToColorSpace(v6.copy(this),J),Math.round(Z6(v6.r*255,0,255))*65536+Math.round(Z6(v6.g*255,0,255))*256+Math.round(Z6(v6.b*255,0,255))}getHexString(J="srgb"){return("000000"+this.getHex(J).toString(16)).slice(-6)}getHSL(J,Q=K6.workingColorSpace){K6.workingToColorSpace(v6.copy(this),Q);let{r:$,g:Z,b:W}=v6,q=Math.max($,Z,W),K=Math.min($,Z,W),H,U,Y=(K+q)/2;if(K===q)H=0,U=0;else{let X=q-K;switch(U=Y<=0.5?X/(q+K):X/(2-q-K),q){case $:H=(Z-W)/X+(Z<W?6:0);break;case Z:H=(W-$)/X+2;break;case W:H=($-Z)/X+4;break}H/=6}return J.h=H,J.s=U,J.l=Y,J}getRGB(J,Q=K6.workingColorSpace){return K6.workingToColorSpace(v6.copy(this),Q),J.r=v6.r,J.g=v6.g,J.b=v6.b,J}getStyle(J="srgb"){K6.workingToColorSpace(v6.copy(this),J);let{r:Q,g:$,b:Z}=v6;if(J!=="srgb")return`color(${J} ${Q.toFixed(3)} ${$.toFixed(3)} ${Z.toFixed(3)})`;return`rgb(${Math.round(Q*255)},${Math.round($*255)},${Math.round(Z*255)})`}offsetHSL(J,Q,$){return this.getHSL(T7),this.setHSL(T7.h+J,T7.s+Q,T7.l+$)}add(J){return this.r+=J.r,this.g+=J.g,this.b+=J.b,this}addColors(J,Q){return this.r=J.r+Q.r,this.g=J.g+Q.g,this.b=J.b+Q.b,this}addScalar(J){return this.r+=J,this.g+=J,this.b+=J,this}sub(J){return this.r=Math.max(0,this.r-J.r),this.g=Math.max(0,this.g-J.g),this.b=Math.max(0,this.b-J.b),this}multiply(J){return this.r*=J.r,this.g*=J.g,this.b*=J.b,this}multiplyScalar(J){return this.r*=J,this.g*=J,this.b*=J,this}lerp(J,Q){return this.r+=(J.r-this.r)*Q,this.g+=(J.g-this.g)*Q,this.b+=(J.b-this.b)*Q,this}lerpColors(J,Q,$){return this.r=J.r+(Q.r-J.r)*$,this.g=J.g+(Q.g-J.g)*$,this.b=J.b+(Q.b-J.b)*$,this}lerpHSL(J,Q){this.getHSL(T7),J.getHSL(w0);let $=t9(T7.h,w0.h,Q),Z=t9(T7.s,w0.s,Q),W=t9(T7.l,w0.l,Q);return this.setHSL($,Z,W),this}setFromVector3(J){return this.r=J.x,this.g=J.y,this.b=J.z,this}applyMatrix3(J){let Q=this.r,$=this.g,Z=this.b,W=J.elements;return this.r=W[0]*Q+W[3]*$+W[6]*Z,this.g=W[1]*Q+W[4]*$+W[7]*Z,this.b=W[2]*Q+W[5]*$+W[8]*Z,this}equals(J){return J.r===this.r&&J.g===this.g&&J.b===this.b}fromArray(J,Q=0){return this.r=J[Q],this.g=J[Q+1],this.b=J[Q+2],this}toArray(J=[],Q=0){return J[Q]=this.r,J[Q+1]=this.g,J[Q+2]=this.b,J}fromBufferAttribute(J,Q){return this.r=J.getX(Q),this.g=J.getY(Q),this.b=J.getZ(Q),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}var v6=new r8;r8.NAMES=u$;class f9 extends z6{constructor(){super();if(this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new Y7,this.environmentIntensity=1,this.environmentRotation=new Y7,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(J,Q){return super.copy(J,Q),this.background=J.background!==null?J.background.clone():null,this.environment=J.environment!==null?J.environment.clone():null,this.fog=J.fog!==null?J.fog.clone():null,this.backgroundBlurriness=J.backgroundBlurriness,this.backgroundIntensity=J.backgroundIntensity,this.backgroundRotation.copy(J.backgroundRotation),this.environmentIntensity=J.environmentIntensity,this.environmentRotation.copy(J.environmentRotation),this.overrideMaterial=J.overrideMaterial!==null?J.overrideMaterial.clone():null,this.matrixAutoUpdate=J.matrixAutoUpdate,this}toJSON(J){let Q=super.toJSON(J);if(this.fog!==null)Q.object.fog=this.fog.toJSON();return Q.object.backgroundBlurriness=this.backgroundBlurriness,Q.object.backgroundIntensity=this.backgroundIntensity,Q.object.backgroundRotation=this.backgroundRotation.toArray(),Q.object.environmentIntensity=this.environmentIntensity,Q.object.environmentRotation=this.environmentRotation.toArray(),Q}}var r6=new u,R7=new u,i5=new u,M7=new u,F9=new u,D9=new u,zQ=new u,o5=new u,a5=new u,r5=new u,t5=new R6,e5=new R6,J1=new R6;class d6{constructor(J=new u,Q=new u,$=new u){this.a=J,this.b=Q,this.c=$}static getNormal(J,Q,$,Z){Z.subVectors($,Q),r6.subVectors(J,Q),Z.cross(r6);let W=Z.lengthSq();if(W>0)return Z.multiplyScalar(1/Math.sqrt(W));return Z.set(0,0,0)}static getBarycoord(J,Q,$,Z,W){r6.subVectors(Z,Q),R7.subVectors($,Q),i5.subVectors(J,Q);let q=r6.dot(r6),K=r6.dot(R7),H=r6.dot(i5),U=R7.dot(R7),Y=R7.dot(i5),X=q*U-K*K;if(X===0)return W.set(0,0,0),null;let G=1/X,N=(U*H-K*Y)*G,F=(q*Y-K*H)*G;return W.set(1-N-F,F,N)}static containsPoint(J,Q,$,Z){if(this.getBarycoord(J,Q,$,Z,M7)===null)return!1;return M7.x>=0&&M7.y>=0&&M7.x+M7.y<=1}static getInterpolation(J,Q,$,Z,W,q,K,H){if(this.getBarycoord(J,Q,$,Z,M7)===null){if(H.x=0,H.y=0,"z"in H)H.z=0;if("w"in H)H.w=0;return null}return H.setScalar(0),H.addScaledVector(W,M7.x),H.addScaledVector(q,M7.y),H.addScaledVector(K,M7.z),H}static getInterpolatedAttribute(J,Q,$,Z,W,q){return t5.setScalar(0),e5.setScalar(0),J1.setScalar(0),t5.fromBufferAttribute(J,Q),e5.fromBufferAttribute(J,$),J1.fromBufferAttribute(J,Z),q.setScalar(0),q.addScaledVector(t5,W.x),q.addScaledVector(e5,W.y),q.addScaledVector(J1,W.z),q}static isFrontFacing(J,Q,$,Z){return r6.subVectors($,Q),R7.subVectors(J,Q),r6.cross(R7).dot(Z)<0}set(J,Q,$){return this.a.copy(J),this.b.copy(Q),this.c.copy($),this}setFromPointsAndIndices(J,Q,$,Z){return this.a.copy(J[Q]),this.b.copy(J[$]),this.c.copy(J[Z]),this}setFromAttributeAndIndices(J,Q,$,Z){return this.a.fromBufferAttribute(J,Q),this.b.fromBufferAttribute(J,$),this.c.fromBufferAttribute(J,Z),this}clone(){return new this.constructor().copy(this)}copy(J){return this.a.copy(J.a),this.b.copy(J.b),this.c.copy(J.c),this}getArea(){return r6.subVectors(this.c,this.b),R7.subVectors(this.a,this.b),r6.cross(R7).length()*0.5}getMidpoint(J){return J.addVectors(this.a,this.b).add(this.c).multiplyScalar(0.3333333333333333)}getNormal(J){return d6.getNormal(this.a,this.b,this.c,J)}getPlane(J){return J.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(J,Q){return d6.getBarycoord(J,this.a,this.b,this.c,Q)}getInterpolation(J,Q,$,Z,W){return d6.getInterpolation(J,this.a,this.b,this.c,Q,$,Z,W)}containsPoint(J){return d6.containsPoint(J,this.a,this.b,this.c)}isFrontFacing(J){return d6.isFrontFacing(this.a,this.b,this.c,J)}intersectsBox(J){return J.intersectsTriangle(this)}closestPointToPoint(J,Q){let $=this.a,Z=this.b,W=this.c,q,K;F9.subVectors(Z,$),D9.subVectors(W,$),o5.subVectors(J,$);let H=F9.dot(o5),U=D9.dot(o5);if(H<=0&&U<=0)return Q.copy($);a5.subVectors(J,Z);let Y=F9.dot(a5),X=D9.dot(a5);if(Y>=0&&X<=Y)return Q.copy(Z);let G=H*X-Y*U;if(G<=0&&H>=0&&Y<=0&&H-Y>0)return q=H/(H-Y),Q.copy($).addScaledVector(F9,q);r5.subVectors(J,W);let N=F9.dot(r5),F=D9.dot(r5);if(F>=0&&N<=F)return Q.copy(W);let M=N*U-H*F;if(M<=0&&U>=0&&F<=0)return K=U/(U-F),Q.copy($).addScaledVector(D9,K);let L=Y*F-N*X;if(L<=0&&X-Y>=0&&N-F>=0)return zQ.subVectors(W,Z),K=(X-Y)/(X-Y+(N-F)),Q.copy(Z).addScaledVector(zQ,K);let E=1/(L+M+G);return q=M*E,K=G*E,Q.copy($).addScaledVector(F9,q).addScaledVector(D9,K)}equals(J){return J.a.equals(this.a)&&J.b.equals(this.b)&&J.c.equals(this.c)}}class C7{constructor(J=new u(1/0,1/0,1/0),Q=new u(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=J,this.max=Q}set(J,Q){return this.min.copy(J),this.max.copy(Q),this}setFromArray(J){this.makeEmpty();for(let Q=0,$=J.length;Q<$;Q+=3)this.expandByPoint(t6.fromArray(J,Q));return this}setFromBufferAttribute(J){this.makeEmpty();for(let Q=0,$=J.count;Q<$;Q++)this.expandByPoint(t6.fromBufferAttribute(J,Q));return this}setFromPoints(J){this.makeEmpty();for(let Q=0,$=J.length;Q<$;Q++)this.expandByPoint(J[Q]);return this}setFromCenterAndSize(J,Q){let $=t6.copy(Q).multiplyScalar(0.5);return this.min.copy(J).sub($),this.max.copy(J).add($),this}setFromObject(J,Q=!1){return this.makeEmpty(),this.expandByObject(J,Q)}clone(){return new this.constructor().copy(this)}copy(J){return this.min.copy(J.min),this.max.copy(J.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(J){return this.isEmpty()?J.set(0,0,0):J.addVectors(this.min,this.max).multiplyScalar(0.5)}getSize(J){return this.isEmpty()?J.set(0,0,0):J.subVectors(this.max,this.min)}expandByPoint(J){return this.min.min(J),this.max.max(J),this}expandByVector(J){return this.min.sub(J),this.max.add(J),this}expandByScalar(J){return this.min.addScalar(-J),this.max.addScalar(J),this}expandByObject(J,Q=!1){J.updateWorldMatrix(!1,!1);let $=J.geometry;if($!==void 0){let W=$.getAttribute("position");if(Q===!0&&W!==void 0&&J.isInstancedMesh!==!0&&J.isBatchedMesh!==!0)for(let q=0,K=W.count;q<K;q++){if(J.isMesh===!0)J.getVertexPosition(q,t6);else t6.fromBufferAttribute(W,q);t6.applyMatrix4(J.matrixWorld),this.expandByPoint(t6)}else{if(J.boundingBox!==void 0){if(J.boundingBox===null)J.computeBoundingBox();T0.copy(J.boundingBox)}else{if($.boundingBox===null)$.computeBoundingBox();T0.copy($.boundingBox)}T0.applyMatrix4(J.matrixWorld),this.union(T0)}}let Z=J.children;for(let W=0,q=Z.length;W<q;W++)this.expandByObject(Z[W],Q);return this}containsPoint(J){return J.x>=this.min.x&&J.x<=this.max.x&&J.y>=this.min.y&&J.y<=this.max.y&&J.z>=this.min.z&&J.z<=this.max.z}containsBox(J){return this.min.x<=J.min.x&&J.max.x<=this.max.x&&this.min.y<=J.min.y&&J.max.y<=this.max.y&&this.min.z<=J.min.z&&J.max.z<=this.max.z}getParameter(J,Q){return Q.set((J.x-this.min.x)/(this.max.x-this.min.x),(J.y-this.min.y)/(this.max.y-this.min.y),(J.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(J){return J.max.x>=this.min.x&&J.min.x<=this.max.x&&J.max.y>=this.min.y&&J.min.y<=this.max.y&&J.max.z>=this.min.z&&J.min.z<=this.max.z}intersectsSphere(J){return this.clampPoint(J.center,t6),t6.distanceToSquared(J.center)<=J.radius*J.radius}intersectsPlane(J){let Q,$;if(J.normal.x>0)Q=J.normal.x*this.min.x,$=J.normal.x*this.max.x;else Q=J.normal.x*this.max.x,$=J.normal.x*this.min.x;if(J.normal.y>0)Q+=J.normal.y*this.min.y,$+=J.normal.y*this.max.y;else Q+=J.normal.y*this.max.y,$+=J.normal.y*this.min.y;if(J.normal.z>0)Q+=J.normal.z*this.min.z,$+=J.normal.z*this.max.z;else Q+=J.normal.z*this.max.z,$+=J.normal.z*this.min.z;return Q<=-J.constant&&$>=-J.constant}intersectsTriangle(J){if(this.isEmpty())return!1;this.getCenter(c9),S0.subVectors(this.max,c9),O9.subVectors(J.a,c9),R9.subVectors(J.b,c9),M9.subVectors(J.c,c9),S7.subVectors(R9,O9),j7.subVectors(M9,R9),d7.subVectors(O9,M9);let Q=[0,-S7.z,S7.y,0,-j7.z,j7.y,0,-d7.z,d7.y,S7.z,0,-S7.x,j7.z,0,-j7.x,d7.z,0,-d7.x,-S7.y,S7.x,0,-j7.y,j7.x,0,-d7.y,d7.x,0];if(!Q1(Q,O9,R9,M9,S0))return!1;if(Q=[1,0,0,0,1,0,0,0,1],!Q1(Q,O9,R9,M9,S0))return!1;return j0.crossVectors(S7,j7),Q=[j0.x,j0.y,j0.z],Q1(Q,O9,R9,M9,S0)}clampPoint(J,Q){return Q.copy(J).clamp(this.min,this.max)}distanceToPoint(J){return this.clampPoint(J,t6).distanceTo(J)}getBoundingSphere(J){if(this.isEmpty())J.makeEmpty();else this.getCenter(J.center),J.radius=this.getSize(t6).length()*0.5;return J}intersect(J){if(this.min.max(J.min),this.max.min(J.max),this.isEmpty())this.makeEmpty();return this}union(J){return this.min.min(J.min),this.max.max(J.max),this}applyMatrix4(J){if(this.isEmpty())return this;return k7[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(J),k7[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(J),k7[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(J),k7[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(J),k7[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(J),k7[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(J),k7[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(J),k7[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(J),this.setFromPoints(k7),this}translate(J){return this.min.add(J),this.max.add(J),this}equals(J){return J.min.equals(this.min)&&J.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(J){return this.min.fromArray(J.min),this.max.fromArray(J.max),this}}var k7=[new u,new u,new u,new u,new u,new u,new u,new u],t6=new u,T0=new C7,O9=new u,R9=new u,M9=new u,S7=new u,j7=new u,d7=new u,c9=new u,S0=new u,j0=new u,u7=new u;function Q1(J,Q,$,Z,W){for(let q=0,K=J.length-3;q<=K;q+=3){u7.fromArray(J,q);let H=W.x*Math.abs(u7.x)+W.y*Math.abs(u7.y)+W.z*Math.abs(u7.z),U=Q.dot(u7),Y=$.dot(u7),X=Z.dot(u7);if(Math.max(-Math.max(U,Y,X),Math.min(U,Y,X))>H)return!1}return!0}var L6=new u,y0=new L8,PW=0;class U7 extends A7{constructor(J,Q,$=!1){super();if(Array.isArray(J))throw TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:PW++}),this.name="",this.array=J,this.itemSize=Q,this.count=J!==void 0?J.length/Q:0,this.normalized=$,this.usage=35044,this.updateRanges=[],this.gpuType=1015,this.version=0,this._normalizationScale=J!==void 0?kJ(J):void 0}onUploadCallback(){}set needsUpdate(J){if(J===!0)this.version++}setUsage(J){return this.usage=J,this}addUpdateRange(J,Q){this.updateRanges.push({start:J,count:Q})}clearUpdateRanges(){this.updateRanges.length=0}copy(J){return this.name=J.name,this.array=new J.array.constructor(J.array),this.itemSize=J.itemSize,this.count=J.count,this.normalized=J.normalized,this.usage=J.usage,this.gpuType=J.gpuType,this._normalizationScale=J._normalizationScale,this}copyAt(J,Q,$){J*=this.itemSize,$*=Q.itemSize;for(let Z=0,W=this.itemSize;Z<W;Z++)this.array[J+Z]=Q.array[$+Z];return this}copyArray(J){return this.array.set(J),this}applyMatrix3(J){if(this.itemSize===2)for(let Q=0,$=this.count;Q<$;Q++)y0.fromBufferAttribute(this,Q),y0.applyMatrix3(J),this.setXY(Q,y0.x,y0.y);else if(this.itemSize===3)for(let Q=0,$=this.count;Q<$;Q++)L6.fromBufferAttribute(this,Q),L6.applyMatrix3(J),this.setXYZ(Q,L6.x,L6.y,L6.z);return this}applyMatrix4(J){for(let Q=0,$=this.count;Q<$;Q++)L6.fromBufferAttribute(this,Q),L6.applyMatrix4(J),this.setXYZ(Q,L6.x,L6.y,L6.z);return this}applyNormalMatrix(J){for(let Q=0,$=this.count;Q<$;Q++)L6.fromBufferAttribute(this,Q),L6.applyNormalMatrix(J),this.setXYZ(Q,L6.x,L6.y,L6.z);return this}transformDirection(J){for(let Q=0,$=this.count;Q<$;Q++)L6.fromBufferAttribute(this,Q),L6.transformDirection(J),this.setXYZ(Q,L6.x,L6.y,L6.z);return this}set(J,Q=0){return this.array.set(J,Q),this}getComponent(J,Q){let $=this.array[J*this.itemSize+Q];if(this.normalized)$=this._denormalize($);return $}setComponent(J,Q,$){if(this.normalized)$=this._normalize($);return this.array[J*this.itemSize+Q]=$,this}getX(J){let Q=this.array[J*this.itemSize];if(this.normalized)Q=this._denormalize(Q);return Q}setX(J,Q){if(this.normalized)Q=this._normalize(Q);return this.array[J*this.itemSize]=Q,this}getY(J){let Q=this.array[J*this.itemSize+1];if(this.normalized)Q=this._denormalize(Q);return Q}setY(J,Q){if(this.normalized)Q=this._normalize(Q);return this.array[J*this.itemSize+1]=Q,this}getZ(J){let Q=this.array[J*this.itemSize+2];if(this.normalized)Q=this._denormalize(Q);return Q}setZ(J,Q){if(this.normalized)Q=this._normalize(Q);return this.array[J*this.itemSize+2]=Q,this}getW(J){let Q=this.array[J*this.itemSize+3];if(this.normalized)Q=this._denormalize(Q);return Q}setW(J,Q){if(this.normalized)Q=this._normalize(Q);return this.array[J*this.itemSize+3]=Q,this}setXY(J,Q,$){if(J*=this.itemSize,this.normalized)Q=this._normalize(Q),$=this._normalize($);return this.array[J+0]=Q,this.array[J+1]=$,this}setXYZ(J,Q,$,Z){if(J*=this.itemSize,this.normalized)Q=this._normalize(Q),$=this._normalize($),Z=this._normalize(Z);return this.array[J+0]=Q,this.array[J+1]=$,this.array[J+2]=Z,this}setXYZW(J,Q,$,Z,W){if(J*=this.itemSize,this.normalized)Q=this._normalize(Q),$=this._normalize($),Z=this._normalize(Z),W=this._normalize(W);return this.array[J+0]=Q,this.array[J+1]=$,this.array[J+2]=Z,this.array[J+3]=W,this}onUpload(J){return this.onUploadCallback=J,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){let J={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return J.name=this.name,J.usage=this.usage,J.gpuType=this.gpuType,J}dispose(){this.dispatchEvent({type:"dispose"})}_denormalize(J){let Q=this._normalizationScale;return Q!==void 0?Math.max(J/Q,-1):l$(J,this.array)}_normalize(J){let Q=this._normalizationScale;return Q!==void 0?Math.round(J*Q):d$(J,this.array)}}class G5 extends U7{constructor(J,Q,$){super(new Uint16Array(J),Q,$)}}class N5 extends U7{constructor(J,Q,$){super(new Uint32Array(J),Q,$)}}class T6 extends U7{constructor(J,Q,$){super(new Float32Array(J),Q,$)}}var wW=new C7,n9=new u,$1=new u;class Q9{constructor(J=new u,Q=-1){this.isSphere=!0,this.center=J,this.radius=Q}set(J,Q){return this.center.copy(J),this.radius=Q,this}setFromPoints(J,Q){let $=this.center;if(Q!==void 0)$.copy(Q);else wW.setFromPoints(J).getCenter($);let Z=0;for(let W=0,q=J.length;W<q;W++)Z=Math.max(Z,$.distanceToSquared(J[W]));return this.radius=Math.sqrt(Z),this}copy(J){return this.center.copy(J.center),this.radius=J.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(J){return J.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(J){return J.distanceTo(this.center)-this.radius}intersectsSphere(J){let Q=this.radius+J.radius;return J.center.distanceToSquared(this.center)<=Q*Q}intersectsBox(J){return J.intersectsSphere(this)}intersectsPlane(J){return Math.abs(J.distanceToPoint(this.center))<=this.radius}clampPoint(J,Q){let $=this.center.distanceToSquared(J);if(Q.copy(J),$>this.radius*this.radius)Q.sub(this.center).normalize(),Q.multiplyScalar(this.radius).add(this.center);return Q}getBoundingBox(J){if(this.isEmpty())return J.makeEmpty(),J;return J.set(this.center,this.center),J.expandByScalar(this.radius),J}applyMatrix4(J){return this.center.applyMatrix4(J),this.radius=this.radius*J.getMaxScaleOnAxis(),this}translate(J){return this.center.add(J),this}expandByPoint(J){if(this.isEmpty())return this.center.copy(J),this.radius=0,this;n9.subVectors(J,this.center);let Q=n9.lengthSq();if(Q>this.radius*this.radius){let $=Math.sqrt(Q),Z=($-this.radius)*0.5;this.center.addScaledVector(n9,Z/$),this.radius+=Z}return this}union(J){if(J.isEmpty())return this;if(this.isEmpty())return this.copy(J),this;if(this.center.equals(J.center)===!0)this.radius=Math.max(this.radius,J.radius);else $1.subVectors(J.center,this.center).setLength(J.radius),this.expandByPoint(n9.copy(J.center).add($1)),this.expandByPoint(n9.copy(J.center).sub($1));return this}equals(J){return J.center.equals(this.center)&&J.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(J){return this.radius=J.radius,this.center.fromArray(J.center),this}}var TW=0,l6=new G6,Z1=new z6,k9=new u,p6=new C7,s9=new C7,C6=new u;class $7 extends A7{constructor(){super();this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:TW++}),this.uuid=J9(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.indirectOffset=0,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={},this._transformed=!1}getIndex(){return this.index}setIndex(J){if(Array.isArray(J))this.index=new((QW(J))?N5:G5)(J,1);else this.index=J;return this}setIndirect(J,Q=0){return this.indirect=J,this.indirectOffset=Q,this}getIndirect(){return this.indirect}getAttribute(J){return this.attributes[J]}setAttribute(J,Q){return this.attributes[J]=Q,this}deleteAttribute(J){return delete this.attributes[J],this}hasAttribute(J){return this.attributes[J]!==void 0}addGroup(J,Q,$=0){this.groups.push({start:J,count:Q,materialIndex:$})}clearGroups(){this.groups=[]}setDrawRange(J,Q){this.drawRange.start=J,this.drawRange.count=Q}applyMatrix4(J){let Q=this.attributes.position;if(Q!==void 0)Q.applyMatrix4(J),Q.needsUpdate=!0;let $=this.attributes.normal;if($!==void 0){let W=new i8().getNormalMatrix(J);$.applyNormalMatrix(W),$.needsUpdate=!0}let Z=this.attributes.tangent;if(Z!==void 0)Z.transformDirection(J),Z.needsUpdate=!0;if(this.boundingBox!==null)this.computeBoundingBox();if(this.boundingSphere!==null)this.computeBoundingSphere();return this._transformed=!0,this}applyQuaternion(J){return l6.makeRotationFromQuaternion(J),this.applyMatrix4(l6),this}rotateX(J){return l6.makeRotationX(J),this.applyMatrix4(l6),this}rotateY(J){return l6.makeRotationY(J),this.applyMatrix4(l6),this}rotateZ(J){return l6.makeRotationZ(J),this.applyMatrix4(l6),this}translate(J,Q,$){return l6.makeTranslation(J,Q,$),this.applyMatrix4(l6),this}scale(J,Q,$){return l6.makeScale(J,Q,$),this.applyMatrix4(l6),this}lookAt(J){return Z1.lookAt(J),Z1.updateMatrix(),this.applyMatrix4(Z1.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(k9).negate(),this.translate(k9.x,k9.y,k9.z),this}setFromPoints(J){let Q=this.getAttribute("position");if(Q===void 0){let $=[];for(let Z=0,W=J.length;Z<W;Z++){let q=J[Z];$.push(q.x,q.y,q.z||0)}this.setAttribute("position",new T6($,3))}else{let $=Math.min(J.length,Q.count);for(let Z=0;Z<$;Z++){let W=J[Z];Q.setXYZ(Z,W.x,W.y,W.z||0)}if(J.length>Q.count)t8("BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry.");Q.needsUpdate=!0}return this}computeBoundingBox(){if(this.boundingBox===null)this.boundingBox=new C7;let J=this.attributes.position,Q=this.morphAttributes.position;if(J&&J.isGLBufferAttribute){e8("BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new u(-1/0,-1/0,-1/0),new u(1/0,1/0,1/0));return}if(J!==void 0){if(this.boundingBox.setFromBufferAttribute(J),Q)for(let $=0,Z=Q.length;$<Z;$++){let W=Q[$];if(p6.setFromBufferAttribute(W),this.morphTargetsRelative)C6.addVectors(this.boundingBox.min,p6.min),this.boundingBox.expandByPoint(C6),C6.addVectors(this.boundingBox.max,p6.max),this.boundingBox.expandByPoint(C6);else this.boundingBox.expandByPoint(p6.min),this.boundingBox.expandByPoint(p6.max)}}else this.boundingBox.makeEmpty();if(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))e8('BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){if(this.boundingSphere===null)this.boundingSphere=new Q9;let J=this.attributes.position,Q=this.morphAttributes.position;if(J&&J.isGLBufferAttribute){e8("BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new u,1/0);return}if(J){let $=this.boundingSphere.center;if(p6.setFromBufferAttribute(J),Q)for(let W=0,q=Q.length;W<q;W++){let K=Q[W];if(s9.setFromBufferAttribute(K),this.morphTargetsRelative)C6.addVectors(p6.min,s9.min),p6.expandByPoint(C6),C6.addVectors(p6.max,s9.max),p6.expandByPoint(C6);else p6.expandByPoint(s9.min),p6.expandByPoint(s9.max)}p6.getCenter($);let Z=0;for(let W=0,q=J.count;W<q;W++)C6.fromBufferAttribute(J,W),Z=Math.max(Z,$.distanceToSquared(C6));if(Q)for(let W=0,q=Q.length;W<q;W++){let K=Q[W],H=this.morphTargetsRelative;for(let U=0,Y=K.count;U<Y;U++){if(C6.fromBufferAttribute(K,U),H)k9.fromBufferAttribute(J,U),C6.add(k9);Z=Math.max(Z,$.distanceToSquared(C6))}}if(this.boundingSphere.radius=Math.sqrt(Z),isNaN(this.boundingSphere.radius))e8('BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){let J=this.index,Q=this.attributes;if(J===null||Q.position===void 0||Q.normal===void 0||Q.uv===void 0){e8("BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}let{position:$,normal:Z,uv:W}=Q,q=this.getAttribute("tangent");if(q===void 0||q.count!==$.count)q=new U7(new Float32Array(4*$.count),4),this.setAttribute("tangent",q);let K=[],H=[],U=new Uint8Array($.count);for(let z=0;z<$.count;z++)K[z]=new u,H[z]=new u;let Y=new u,X=new u,G=new u,N=new L8,F=new L8,M=new L8,L=new u,E=new u;function O(z,m,t){U[z]=U[m]=U[t]=1,Y.fromBufferAttribute($,z),X.fromBufferAttribute($,m),G.fromBufferAttribute($,t),N.fromBufferAttribute(W,z),F.fromBufferAttribute(W,m),M.fromBufferAttribute(W,t),X.sub(Y),G.sub(Y),F.sub(N),M.sub(N);let v=1/(F.x*M.y-M.x*F.y);if(!isFinite(v))return;L.copy(X).multiplyScalar(M.y).addScaledVector(G,-F.y).multiplyScalar(v),E.copy(G).multiplyScalar(F.x).addScaledVector(X,-M.x).multiplyScalar(v),K[z].add(L),K[m].add(L),K[t].add(L),H[z].add(E),H[m].add(E),H[t].add(E)}let _=this.groups;if(_.length===0)_=[{start:0,count:J.count}];for(let z=0,m=_.length;z<m;++z){let t=_[z],v=t.start,J8=t.count;for(let E8=v,T=v+J8;E8<T;E8+=3)O(J.getX(E8+0),J.getX(E8+1),J.getX(E8+2))}let V=new u,B=new u,w=new u,y=new u;function D(z){w.fromBufferAttribute(Z,z),y.copy(w);let m=K[z];V.copy(m),V.sub(w.multiplyScalar(w.dot(m))).normalize(),B.crossVectors(y,m);let v=B.dot(H[z])<0?-1:1;q.setXYZW(z,V.x,V.y,V.z,v)}for(let z=0,m=$.count;z<m;++z)if(U[z])D(z);this._transformed=!0}computeVertexNormals(){let J=this.index,Q=this.getAttribute("position");if(Q!==void 0){let $=this.getAttribute("normal");if($===void 0||$.count!==Q.count)$=new U7(new Float32Array(Q.count*3),3),this.setAttribute("normal",$);else for(let G=0,N=$.count;G<N;G++)$.setXYZ(G,0,0,0);let Z=new u,W=new u,q=new u,K=new u,H=new u,U=new u,Y=new u,X=new u;if(J)for(let G=0,N=J.count;G<N;G+=3){let F=J.getX(G+0),M=J.getX(G+1),L=J.getX(G+2);Z.fromBufferAttribute(Q,F),W.fromBufferAttribute(Q,M),q.fromBufferAttribute(Q,L),Y.subVectors(q,W),X.subVectors(Z,W),Y.cross(X),K.fromBufferAttribute($,F),H.fromBufferAttribute($,M),U.fromBufferAttribute($,L),K.add(Y),H.add(Y),U.add(Y),$.setXYZ(F,K.x,K.y,K.z),$.setXYZ(M,H.x,H.y,H.z),$.setXYZ(L,U.x,U.y,U.z)}else for(let G=0,N=Q.count;G<N;G+=3)Z.fromBufferAttribute(Q,G+0),W.fromBufferAttribute(Q,G+1),q.fromBufferAttribute(Q,G+2),Y.subVectors(q,W),X.subVectors(Z,W),Y.cross(X),$.setXYZ(G+0,Y.x,Y.y,Y.z),$.setXYZ(G+1,Y.x,Y.y,Y.z),$.setXYZ(G+2,Y.x,Y.y,Y.z);this.normalizeNormals(),$.needsUpdate=!0}}normalizeNormals(){let J=this.attributes.normal;for(let Q=0,$=J.count;Q<$;Q++)C6.fromBufferAttribute(J,Q),C6.normalize(),J.setXYZ(Q,C6.x,C6.y,C6.z)}toNonIndexed(){function J(K,H){let{array:U,itemSize:Y,normalized:X}=K,G=new U.constructor(H.length*Y),N=0,F=0;for(let M=0,L=H.length;M<L;M++){if(K.isInterleavedBufferAttribute)N=H[M]*K.data.stride+K.offset;else N=H[M]*Y;for(let E=0;E<Y;E++)G[F++]=U[N++]}return new U7(G,Y,X)}if(this.index===null)return t8("BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;let Q=new $7,$=this.index.array,Z=this.attributes;for(let K in Z){let H=Z[K],U=J(H,$);Q.setAttribute(K,U)}let W=this.morphAttributes;for(let K in W){let H=[],U=W[K];for(let Y=0,X=U.length;Y<X;Y++){let G=U[Y],N=J(G,$);H.push(N)}Q.morphAttributes[K]=H}Q.morphTargetsRelative=this.morphTargetsRelative;let q=this.groups;for(let K=0,H=q.length;K<H;K++){let U=q[K];Q.addGroup(U.start,U.count,U.materialIndex)}return Q}toJSON(){let J={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(J.uuid=this.uuid,J.type=this.parameters!==void 0&&this._transformed===!0?"BufferGeometry":this.type,J.name=this.name,Object.keys(this.userData).length>0)J.userData=this.userData;if(this.parameters!==void 0&&this._transformed!==!0){let H=this.parameters;for(let U in H)if(H[U]!==void 0)J[U]=H[U];return J}J.data={attributes:{}};let Q=this.index;if(Q!==null)J.data.index={type:Q.array.constructor.name,array:Array.prototype.slice.call(Q.array)};let $=this.attributes;for(let H in $){let U=$[H];J.data.attributes[H]=U.toJSON(J.data)}let Z={},W=!1;for(let H in this.morphAttributes){let U=this.morphAttributes[H],Y=[];for(let X=0,G=U.length;X<G;X++){let N=U[X];Y.push(N.toJSON(J.data))}if(Y.length>0)Z[H]=Y,W=!0}if(W)J.data.morphAttributes=Z,J.data.morphTargetsRelative=this.morphTargetsRelative;let q=this.groups;if(q.length>0)J.data.groups=JSON.parse(JSON.stringify(q));let K=this.boundingSphere;if(K!==null)J.data.boundingSphere=K.toJSON();return J}clone(){return new this.constructor().copy(this)}copy(J){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;let Q={};this.name=J.name;let $=J.index;if($!==null)this.setIndex($.clone());let Z=J.attributes;for(let U in Z){let Y=Z[U];this.setAttribute(U,Y.clone(Q))}let W=J.morphAttributes;for(let U in W){let Y=[],X=W[U];for(let G=0,N=X.length;G<N;G++)Y.push(X[G].clone(Q));this.morphAttributes[U]=Y}this.morphTargetsRelative=J.morphTargetsRelative;let q=J.groups;for(let U=0,Y=q.length;U<Y;U++){let X=q[U];this.addGroup(X.start,X.count,X.materialIndex)}let K=J.boundingBox;if(K!==null)this.boundingBox=K.clone();let H=J.boundingSphere;if(H!==null)this.boundingSphere=H.clone();return this.drawRange.start=J.drawRange.start,this.drawRange.count=J.drawRange.count,this.userData=J.userData,this._transformed=J._transformed,this}dispose(){this.dispatchEvent({type:"dispose"})}}var W1=new u,SW=new u,jW=new i8;class q7{constructor(J=new u(1,0,0),Q=0){this.isPlane=!0,this.normal=J,this.constant=Q}set(J,Q){return this.normal.copy(J),this.constant=Q,this}setComponents(J,Q,$,Z){return this.normal.set(J,Q,$),this.constant=Z,this}setFromNormalAndCoplanarPoint(J,Q){return this.normal.copy(J),this.constant=-Q.dot(this.normal),this}setFromCoplanarPoints(J,Q,$){let Z=W1.subVectors($,Q).cross(SW.subVectors(J,Q)).normalize();return this.setFromNormalAndCoplanarPoint(Z,J),this}copy(J){return this.normal.copy(J.normal),this.constant=J.constant,this}normalize(){let J=1/this.normal.length();return this.normal.multiplyScalar(J),this.constant*=J,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(J){return this.normal.dot(J)+this.constant}distanceToSphere(J){return this.distanceToPoint(J.center)-J.radius}projectPoint(J,Q){return Q.copy(J).addScaledVector(this.normal,-this.distanceToPoint(J))}intersectLine(J,Q,$=!0){let Z=J.delta(W1),W=this.normal.dot(Z);if(W===0){if(this.distanceToPoint(J.start)===0)return Q.copy(J.start);return null}let q=-(J.start.dot(this.normal)+this.constant)/W;if($===!0&&(q<0||q>1))return null;return Q.copy(J.start).addScaledVector(Z,q)}intersectsLine(J){let Q=this.distanceToPoint(J.start),$=this.distanceToPoint(J.end);return Q<0&&$>0||$<0&&Q>0}intersectsBox(J){return J.intersectsPlane(this)}intersectsSphere(J){return J.intersectsPlane(this)}coplanarPoint(J){return J.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(J,Q){let $=Q||jW.getNormalMatrix(J),Z=this.coplanarPoint(W1).applyMatrix4(J),W=this.normal.applyMatrix3($).normalize();return this.constant=-Z.dot(W),this}translate(J){return this.constant-=J.dot(this.normal),this}equals(J){return J.normal.equals(this.normal)&&J.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(J){return this.normal.fromArray(J.normal),this.constant=J.constant,this}}var yW=0;class h7 extends A7{constructor(){super();this.isMaterial=!0,Object.defineProperty(this,"id",{value:yW++}),this.uuid=J9(),this.name="",this.type="Material",this.blending=1,this.side=0,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=204,this.blendDst=205,this.blendEquation=100,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new r8(0,0,0),this.blendAlpha=0,this.depthFunc=3,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=519,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=7680,this.stencilZFail=7680,this.stencilZPass=7680,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(J){if(this._alphaTest>0!==J>0)this.version++;this._alphaTest=J}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(J){if(J===void 0)return;for(let Q in J){let $=J[Q];if($===void 0){t8(`Material: parameter '${Q}' has value of undefined.`);continue}let Z=this[Q];if(Z===void 0){t8(`Material: '${Q}' is not a property of THREE.${this.type}.`);continue}if(Z&&Z.isColor)Z.set($);else if(Z&&Z.isVector2&&($&&$.isVector2)||Z&&Z.isEuler&&($&&$.isEuler)||Z&&Z.isVector3&&($&&$.isVector3))Z.copy($);else this[Q]=$}}toJSON(J){let Q=J===void 0||typeof J==="string";if(Q)J={textures:{},images:{}};let $={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};if($.uuid=this.uuid,$.type=this.type,$.blending=this.blending,$.side=this.side,$.shadowSide=this.shadowSide,$.vertexColors=this.vertexColors,$.opacity=this.opacity,$.transparent=this.transparent,$.blendSrc=this.blendSrc,$.blendDst=this.blendDst,$.blendEquation=this.blendEquation,$.blendSrcAlpha=this.blendSrcAlpha,$.blendDstAlpha=this.blendDstAlpha,$.blendEquationAlpha=this.blendEquationAlpha,$.blendColor=this.blendColor.getHex(),$.blendAlpha=this.blendAlpha,$.depthFunc=this.depthFunc,$.depthTest=this.depthTest,$.depthWrite=this.depthWrite,$.colorWrite=this.colorWrite,$.clipIntersection=this.clipIntersection,$.clipShadows=this.clipShadows,$.stencilWriteMask=this.stencilWriteMask,$.stencilFunc=this.stencilFunc,$.stencilRef=this.stencilRef,$.stencilFuncMask=this.stencilFuncMask,$.stencilFail=this.stencilFail,$.stencilZFail=this.stencilZFail,$.stencilZPass=this.stencilZPass,$.stencilWrite=this.stencilWrite,$.polygonOffset=this.polygonOffset,$.polygonOffsetFactor=this.polygonOffsetFactor,$.polygonOffsetUnits=this.polygonOffsetUnits,$.dithering=this.dithering,$.alphaTest=this.alphaTest,$.alphaHash=this.alphaHash,$.alphaToCoverage=this.alphaToCoverage,$.premultipliedAlpha=this.premultipliedAlpha,$.forceSinglePass=this.forceSinglePass,$.allowOverride=this.allowOverride,$.visible=this.visible,$.toneMapped=this.toneMapped,$.name=this.name,this.color&&this.color.isColor)$.color=this.color.getHex();if(this.roughness!==void 0)$.roughness=this.roughness;if(this.metalness!==void 0)$.metalness=this.metalness;if(this.sheen!==void 0)$.sheen=this.sheen;if(this.sheenColor&&this.sheenColor.isColor)$.sheenColor=this.sheenColor.getHex();if(this.sheenRoughness!==void 0)$.sheenRoughness=this.sheenRoughness;if(this.emissive&&this.emissive.isColor)$.emissive=this.emissive.getHex();if(this.emissiveIntensity!==void 0)$.emissiveIntensity=this.emissiveIntensity;if(this.specular&&this.specular.isColor)$.specular=this.specular.getHex();if(this.specularIntensity!==void 0)$.specularIntensity=this.specularIntensity;if(this.specularColor&&this.specularColor.isColor)$.specularColor=this.specularColor.getHex();if(this.shininess!==void 0)$.shininess=this.shininess;if(this.clearcoat!==void 0)$.clearcoat=this.clearcoat;if(this.clearcoatRoughness!==void 0)$.clearcoatRoughness=this.clearcoatRoughness;if(this.diffuseRoughness!==void 0)$.diffuseRoughness=this.diffuseRoughness;if(this.diffuseRoughnessMap&&this.diffuseRoughnessMap.isTexture)$.diffuseRoughnessMap=this.diffuseRoughnessMap.toJSON(J).uuid;if(this.clearcoatMap&&this.clearcoatMap.isTexture)$.clearcoatMap=this.clearcoatMap.toJSON(J).uuid;if(this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture)$.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(J).uuid;if(this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture)$.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(J).uuid,$.clearcoatNormalScale=this.clearcoatNormalScale.toArray();if(this.sheenColorMap&&this.sheenColorMap.isTexture)$.sheenColorMap=this.sheenColorMap.toJSON(J).uuid;if(this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture)$.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(J).uuid;if(this.dispersion!==void 0)$.dispersion=this.dispersion;if(this.retroreflectivity!==void 0)$.retroreflectivity=this.retroreflectivity;if(this.iridescence!==void 0)$.iridescence=this.iridescence;if(this.iridescenceIOR!==void 0)$.iridescenceIOR=this.iridescenceIOR;if(this.iridescenceThicknessMinimum!==void 0)$.iridescenceThicknessMinimum=this.iridescenceThicknessMinimum;if(this.iridescenceThicknessMaximum!==void 0)$.iridescenceThicknessMaximum=this.iridescenceThicknessMaximum;if(this.iridescenceMap&&this.iridescenceMap.isTexture)$.iridescenceMap=this.iridescenceMap.toJSON(J).uuid;if(this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture)$.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(J).uuid;if(this.anisotropy!==void 0)$.anisotropy=this.anisotropy;if(this.anisotropyRotation!==void 0)$.anisotropyRotation=this.anisotropyRotation;if(this.anisotropyMap&&this.anisotropyMap.isTexture)$.anisotropyMap=this.anisotropyMap.toJSON(J).uuid;if(this.map&&this.map.isTexture)$.map=this.map.toJSON(J).uuid;if(this.matcap&&this.matcap.isTexture)$.matcap=this.matcap.toJSON(J).uuid;if(this.alphaMap&&this.alphaMap.isTexture)$.alphaMap=this.alphaMap.toJSON(J).uuid;if(this.lightMap&&this.lightMap.isTexture)$.lightMap=this.lightMap.toJSON(J).uuid,$.lightMapIntensity=this.lightMapIntensity;if(this.aoMap&&this.aoMap.isTexture)$.aoMap=this.aoMap.toJSON(J).uuid,$.aoMapIntensity=this.aoMapIntensity;if(this.bumpMap&&this.bumpMap.isTexture)$.bumpMap=this.bumpMap.toJSON(J).uuid,$.bumpScale=this.bumpScale;if(this.normalMap&&this.normalMap.isTexture)$.normalMap=this.normalMap.toJSON(J).uuid,$.normalMapType=this.normalMapType,$.normalScale=this.normalScale.toArray();if(this.displacementMap&&this.displacementMap.isTexture)$.displacementMap=this.displacementMap.toJSON(J).uuid,$.displacementScale=this.displacementScale,$.displacementBias=this.displacementBias;if(this.roughnessMap&&this.roughnessMap.isTexture)$.roughnessMap=this.roughnessMap.toJSON(J).uuid;if(this.metalnessMap&&this.metalnessMap.isTexture)$.metalnessMap=this.metalnessMap.toJSON(J).uuid;if(this.emissiveMap&&this.emissiveMap.isTexture)$.emissiveMap=this.emissiveMap.toJSON(J).uuid;if(this.specularMap&&this.specularMap.isTexture)$.specularMap=this.specularMap.toJSON(J).uuid;if(this.specularIntensityMap&&this.specularIntensityMap.isTexture)$.specularIntensityMap=this.specularIntensityMap.toJSON(J).uuid;if(this.specularColorMap&&this.specularColorMap.isTexture)$.specularColorMap=this.specularColorMap.toJSON(J).uuid;if(this.envMap&&this.envMap.isTexture){if($.envMap=this.envMap.toJSON(J).uuid,this.combine!==void 0)$.combine=this.combine}if(this.envMapRotation!==void 0)$.envMapRotation=this.envMapRotation.toArray();if(this.envMapIntensity!==void 0)$.envMapIntensity=this.envMapIntensity;if(this.reflectivity!==void 0)$.reflectivity=this.reflectivity;if(this.refractionRatio!==void 0)$.refractionRatio=this.refractionRatio;if(this.gradientMap&&this.gradientMap.isTexture)$.gradientMap=this.gradientMap.toJSON(J).uuid;if(this.transmission!==void 0)$.transmission=this.transmission;if(this.transmissionMap&&this.transmissionMap.isTexture)$.transmissionMap=this.transmissionMap.toJSON(J).uuid;if(this.thickness!==void 0)$.thickness=this.thickness;if(this.thicknessMap&&this.thicknessMap.isTexture)$.thicknessMap=this.thicknessMap.toJSON(J).uuid;if(this.attenuationDistance!==void 0)$.attenuationDistance=this.attenuationDistance;if(this.attenuationColor!==void 0)$.attenuationColor=this.attenuationColor.getHex();if(this.size!==void 0)$.size=this.size;if(this.sizeAttenuation!==void 0)$.sizeAttenuation=this.sizeAttenuation;if(Array.isArray(this.clippingPlanes)&&this.clippingPlanes.length>0)$.clippingPlanes=this.clippingPlanes.map((W)=>W.toJSON());if(this.rotation!==void 0)$.rotation=this.rotation;if(this.depthPacking!==void 0)$.depthPacking=this.depthPacking;if(this.linewidth!==void 0)$.linewidth=this.linewidth;if(this.linecap!==void 0)$.linecap=this.linecap;if(this.linejoin!==void 0)$.linejoin=this.linejoin;if(this.dashSize!==void 0)$.dashSize=this.dashSize;if(this.gapSize!==void 0)$.gapSize=this.gapSize;if(this.scale!==void 0)$.scale=this.scale;if(this.wireframe!==void 0)$.wireframe=this.wireframe;if(this.wireframeLinewidth!==void 0)$.wireframeLinewidth=this.wireframeLinewidth;if(this.wireframeLinecap!==void 0)$.wireframeLinecap=this.wireframeLinecap;if(this.wireframeLinejoin!==void 0)$.wireframeLinejoin=this.wireframeLinejoin;if(this.flatShading!==void 0)$.flatShading=this.flatShading;if(this.fog!==void 0)$.fog=this.fog;if(Object.keys(this.userData).length>0)$.userData=this.userData;function Z(W){let q=[];for(let K in W){let H=W[K];delete H.metadata,q.push(H)}return q}if(Q){let W=Z(J.textures),q=Z(J.images);if(W.length>0)$.textures=W;if(q.length>0)$.images=q}return $}fromJSON(J,Q){if(J.uuid!==void 0)this.uuid=J.uuid;if(J.name!==void 0)this.name=J.name;if(J.color!==void 0&&this.color!==void 0)this.color.setHex(J.color);if(J.roughness!==void 0)this.roughness=J.roughness;if(J.metalness!==void 0)this.metalness=J.metalness;if(J.sheen!==void 0)this.sheen=J.sheen;if(J.sheenColor!==void 0)this.sheenColor=new r8().setHex(J.sheenColor);if(J.sheenRoughness!==void 0)this.sheenRoughness=J.sheenRoughness;if(J.emissive!==void 0&&this.emissive!==void 0)this.emissive.setHex(J.emissive);if(J.specular!==void 0&&this.specular!==void 0)this.specular.setHex(J.specular);if(J.specularIntensity!==void 0)this.specularIntensity=J.specularIntensity;if(J.specularColor!==void 0&&this.specularColor!==void 0)this.specularColor.setHex(J.specularColor);if(J.shininess!==void 0)this.shininess=J.shininess;if(J.clearcoat!==void 0)this.clearcoat=J.clearcoat;if(J.clearcoatRoughness!==void 0)this.clearcoatRoughness=J.clearcoatRoughness;if(J.diffuseRoughness!==void 0)this.diffuseRoughness=J.diffuseRoughness;if(J.dispersion!==void 0)this.dispersion=J.dispersion;if(J.retroreflectivity!==void 0)this.retroreflectivity=J.retroreflectivity;if(J.iridescence!==void 0)this.iridescence=J.iridescence;if(J.iridescenceIOR!==void 0)this.iridescenceIOR=J.iridescenceIOR;if(J.iridescenceThicknessMinimum!==void 0)this.iridescenceThicknessMinimum=J.iridescenceThicknessMinimum;if(J.iridescenceThicknessMaximum!==void 0)this.iridescenceThicknessMaximum=J.iridescenceThicknessMaximum;if(J.iridescenceThicknessRange!==void 0)this.iridescenceThicknessMinimum=J.iridescenceThicknessRange[0],this.iridescenceThicknessMaximum=J.iridescenceThicknessRange[1];if(J.transmission!==void 0)this.transmission=J.transmission;if(J.thickness!==void 0)this.thickness=J.thickness;if(J.attenuationDistance!==void 0)this.attenuationDistance=J.attenuationDistance;if(J.attenuationColor!==void 0&&this.attenuationColor!==void 0)this.attenuationColor.setHex(J.attenuationColor);if(J.anisotropy!==void 0)this.anisotropy=J.anisotropy;if(J.anisotropyRotation!==void 0)this.anisotropyRotation=J.anisotropyRotation;if(J.fog!==void 0)this.fog=J.fog;if(J.flatShading!==void 0)this.flatShading=J.flatShading;if(J.blending!==void 0)this.blending=J.blending;if(J.combine!==void 0)this.combine=J.combine;if(J.side!==void 0)this.side=J.side;if(J.shadowSide!==void 0)this.shadowSide=J.shadowSide;if(J.opacity!==void 0)this.opacity=J.opacity;if(J.transparent!==void 0)this.transparent=J.transparent;if(J.alphaTest!==void 0)this.alphaTest=J.alphaTest;if(J.alphaHash!==void 0)this.alphaHash=J.alphaHash;if(J.depthFunc!==void 0)this.depthFunc=J.depthFunc;if(J.depthTest!==void 0)this.depthTest=J.depthTest;if(J.depthWrite!==void 0)this.depthWrite=J.depthWrite;if(J.colorWrite!==void 0)this.colorWrite=J.colorWrite;if(J.clippingPlanes!==void 0)this.clippingPlanes=J.clippingPlanes.map(($)=>new q7().fromJSON($));if(J.clipIntersection!==void 0)this.clipIntersection=J.clipIntersection;if(J.clipShadows!==void 0)this.clipShadows=J.clipShadows;if(J.depthPacking!==void 0)this.depthPacking=J.depthPacking;if(J.blendSrc!==void 0)this.blendSrc=J.blendSrc;if(J.blendDst!==void 0)this.blendDst=J.blendDst;if(J.blendEquation!==void 0)this.blendEquation=J.blendEquation;if(J.blendSrcAlpha!==void 0)this.blendSrcAlpha=J.blendSrcAlpha;if(J.blendDstAlpha!==void 0)this.blendDstAlpha=J.blendDstAlpha;if(J.blendEquationAlpha!==void 0)this.blendEquationAlpha=J.blendEquationAlpha;if(J.blendColor!==void 0&&this.blendColor!==void 0)this.blendColor.setHex(J.blendColor);if(J.blendAlpha!==void 0)this.blendAlpha=J.blendAlpha;if(J.stencilWriteMask!==void 0)this.stencilWriteMask=J.stencilWriteMask;if(J.stencilFunc!==void 0)this.stencilFunc=J.stencilFunc;if(J.stencilRef!==void 0)this.stencilRef=J.stencilRef;if(J.stencilFuncMask!==void 0)this.stencilFuncMask=J.stencilFuncMask;if(J.stencilFail!==void 0)this.stencilFail=J.stencilFail;if(J.stencilZFail!==void 0)this.stencilZFail=J.stencilZFail;if(J.stencilZPass!==void 0)this.stencilZPass=J.stencilZPass;if(J.stencilWrite!==void 0)this.stencilWrite=J.stencilWrite;if(J.wireframe!==void 0)this.wireframe=J.wireframe;if(J.wireframeLinewidth!==void 0)this.wireframeLinewidth=J.wireframeLinewidth;if(J.wireframeLinecap!==void 0)this.wireframeLinecap=J.wireframeLinecap;if(J.wireframeLinejoin!==void 0)this.wireframeLinejoin=J.wireframeLinejoin;if(J.rotation!==void 0)this.rotation=J.rotation;if(J.linewidth!==void 0)this.linewidth=J.linewidth;if(J.linecap!==void 0)this.linecap=J.linecap;if(J.linejoin!==void 0)this.linejoin=J.linejoin;if(J.dashSize!==void 0)this.dashSize=J.dashSize;if(J.gapSize!==void 0)this.gapSize=J.gapSize;if(J.scale!==void 0)this.scale=J.scale;if(J.polygonOffset!==void 0)this.polygonOffset=J.polygonOffset;if(J.polygonOffsetFactor!==void 0)this.polygonOffsetFactor=J.polygonOffsetFactor;if(J.polygonOffsetUnits!==void 0)this.polygonOffsetUnits=J.polygonOffsetUnits;if(J.dithering!==void 0)this.dithering=J.dithering;if(J.alphaToCoverage!==void 0)this.alphaToCoverage=J.alphaToCoverage;if(J.premultipliedAlpha!==void 0)this.premultipliedAlpha=J.premultipliedAlpha;if(J.forceSinglePass!==void 0)this.forceSinglePass=J.forceSinglePass;if(J.allowOverride!==void 0)this.allowOverride=J.allowOverride;if(J.visible!==void 0)this.visible=J.visible;if(J.toneMapped!==void 0)this.toneMapped=J.toneMapped;if(J.userData!==void 0)this.userData=J.userData;if(J.vertexColors!==void 0)if(typeof J.vertexColors==="number")this.vertexColors=J.vertexColors>0;else this.vertexColors=J.vertexColors;if(J.size!==void 0)this.size=J.size;if(J.sizeAttenuation!==void 0)this.sizeAttenuation=J.sizeAttenuation;if(J.map!==void 0)this.map=Q[J.map]||null;if(J.matcap!==void 0)this.matcap=Q[J.matcap]||null;if(J.alphaMap!==void 0)this.alphaMap=Q[J.alphaMap]||null;if(J.bumpMap!==void 0)this.bumpMap=Q[J.bumpMap]||null;if(J.bumpScale!==void 0)this.bumpScale=J.bumpScale;if(J.normalMap!==void 0)this.normalMap=Q[J.normalMap]||null;if(J.normalMapType!==void 0)this.normalMapType=J.normalMapType;if(J.normalScale!==void 0){let $=J.normalScale;if(Array.isArray($)===!1)$=[$,$];this.normalScale=new L8().fromArray($)}if(J.displacementMap!==void 0)this.displacementMap=Q[J.displacementMap]||null;if(J.displacementScale!==void 0)this.displacementScale=J.displacementScale;if(J.displacementBias!==void 0)this.displacementBias=J.displacementBias;if(J.roughnessMap!==void 0)this.roughnessMap=Q[J.roughnessMap]||null;if(J.metalnessMap!==void 0)this.metalnessMap=Q[J.metalnessMap]||null;if(J.emissiveMap!==void 0)this.emissiveMap=Q[J.emissiveMap]||null;if(J.emissiveIntensity!==void 0)this.emissiveIntensity=J.emissiveIntensity;if(J.specularMap!==void 0)this.specularMap=Q[J.specularMap]||null;if(J.specularIntensityMap!==void 0)this.specularIntensityMap=Q[J.specularIntensityMap]||null;if(J.specularColorMap!==void 0)this.specularColorMap=Q[J.specularColorMap]||null;if(J.envMap!==void 0)this.envMap=Q[J.envMap]||null;if(J.envMapRotation!==void 0)this.envMapRotation.fromArray(J.envMapRotation);if(J.envMapIntensity!==void 0)this.envMapIntensity=J.envMapIntensity;if(J.reflectivity!==void 0)this.reflectivity=J.reflectivity;if(J.refractionRatio!==void 0)this.refractionRatio=J.refractionRatio;if(J.lightMap!==void 0)this.lightMap=Q[J.lightMap]||null;if(J.lightMapIntensity!==void 0)this.lightMapIntensity=J.lightMapIntensity;if(J.aoMap!==void 0)this.aoMap=Q[J.aoMap]||null;if(J.aoMapIntensity!==void 0)this.aoMapIntensity=J.aoMapIntensity;if(J.gradientMap!==void 0)this.gradientMap=Q[J.gradientMap]||null;if(J.clearcoatMap!==void 0)this.clearcoatMap=Q[J.clearcoatMap]||null;if(J.clearcoatRoughnessMap!==void 0)this.clearcoatRoughnessMap=Q[J.clearcoatRoughnessMap]||null;if(J.clearcoatNormalMap!==void 0)this.clearcoatNormalMap=Q[J.clearcoatNormalMap]||null;if(J.clearcoatNormalScale!==void 0)this.clearcoatNormalScale=new L8().fromArray(J.clearcoatNormalScale);if(J.diffuseRoughnessMap!==void 0)this.diffuseRoughnessMap=Q[J.diffuseRoughnessMap]||null;if(J.iridescenceMap!==void 0)this.iridescenceMap=Q[J.iridescenceMap]||null;if(J.iridescenceThicknessMap!==void 0)this.iridescenceThicknessMap=Q[J.iridescenceThicknessMap]||null;if(J.transmissionMap!==void 0)this.transmissionMap=Q[J.transmissionMap]||null;if(J.thicknessMap!==void 0)this.thicknessMap=Q[J.thicknessMap]||null;if(J.anisotropyMap!==void 0)this.anisotropyMap=Q[J.anisotropyMap]||null;if(J.sheenColorMap!==void 0)this.sheenColorMap=Q[J.sheenColorMap]||null;if(J.sheenRoughnessMap!==void 0)this.sheenRoughnessMap=Q[J.sheenRoughnessMap]||null;return this}clone(){return new this.constructor().copy(this)}copy(J){this.name=J.name,this.blending=J.blending,this.side=J.side,this.vertexColors=J.vertexColors,this.opacity=J.opacity,this.transparent=J.transparent,this.blendSrc=J.blendSrc,this.blendDst=J.blendDst,this.blendEquation=J.blendEquation,this.blendSrcAlpha=J.blendSrcAlpha,this.blendDstAlpha=J.blendDstAlpha,this.blendEquationAlpha=J.blendEquationAlpha,this.blendColor.copy(J.blendColor),this.blendAlpha=J.blendAlpha,this.depthFunc=J.depthFunc,this.depthTest=J.depthTest,this.depthWrite=J.depthWrite,this.stencilWriteMask=J.stencilWriteMask,this.stencilFunc=J.stencilFunc,this.stencilRef=J.stencilRef,this.stencilFuncMask=J.stencilFuncMask,this.stencilFail=J.stencilFail,this.stencilZFail=J.stencilZFail,this.stencilZPass=J.stencilZPass,this.stencilWrite=J.stencilWrite;let Q=J.clippingPlanes,$=null;if(Q!==null){let Z=Q.length;$=Array(Z);for(let W=0;W!==Z;++W)$[W]=Q[W].clone()}return this.clippingPlanes=$,this.clipIntersection=J.clipIntersection,this.clipShadows=J.clipShadows,this.shadowSide=J.shadowSide,this.colorWrite=J.colorWrite,this.precision=J.precision,this.polygonOffset=J.polygonOffset,this.polygonOffsetFactor=J.polygonOffsetFactor,this.polygonOffsetUnits=J.polygonOffsetUnits,this.dithering=J.dithering,this.alphaTest=J.alphaTest,this.alphaHash=J.alphaHash,this.alphaToCoverage=J.alphaToCoverage,this.premultipliedAlpha=J.premultipliedAlpha,this.forceSinglePass=J.forceSinglePass,this.allowOverride=J.allowOverride,this.visible=J.visible,this.toneMapped=J.toneMapped,this.userData=JSON.parse(JSON.stringify(J.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(J){if(J===!0)this.version++}}var L7=new u,q1=new u,v0=new u,f0=new u;class VJ{constructor(J=new u,Q=new u(0,0,-1)){this.origin=J,this.direction=Q}set(J,Q){return this.origin.copy(J),this.direction.copy(Q),this}copy(J){return this.origin.copy(J.origin),this.direction.copy(J.direction),this}at(J,Q){return Q.copy(this.origin).addScaledVector(this.direction,J)}lookAt(J){return this.direction.copy(J).sub(this.origin).normalize(),this}recast(J){return this.origin.copy(this.at(J,L7)),this}closestPointToPoint(J,Q){Q.subVectors(J,this.origin);let $=Q.dot(this.direction);if($<0)return Q.copy(this.origin);return Q.copy(this.origin).addScaledVector(this.direction,$)}distanceToPoint(J){return Math.sqrt(this.distanceSqToPoint(J))}distanceSqToPoint(J){let Q=L7.subVectors(J,this.origin).dot(this.direction);if(Q<0)return this.origin.distanceToSquared(J);return L7.copy(this.origin).addScaledVector(this.direction,Q),L7.distanceToSquared(J)}distanceSqToSegment(J,Q,$,Z){q1.copy(J).add(Q).multiplyScalar(0.5),v0.copy(Q).sub(J).normalize(),f0.copy(this.origin).sub(q1);let W=J.distanceTo(Q)*0.5,q=-this.direction.dot(v0),K=f0.dot(this.direction),H=-f0.dot(v0),U=f0.lengthSq(),Y=Math.abs(1-q*q),X,G,N,F;if(Y>0)if(X=q*H-K,G=q*K-H,F=W*Y,X>=0)if(G>=-F)if(G<=F){let M=1/Y;X*=M,G*=M,N=X*(X+q*G+2*K)+G*(q*X+G+2*H)+U}else G=W,X=Math.max(0,-(q*G+K)),N=-X*X+G*(G+2*H)+U;else G=-W,X=Math.max(0,-(q*G+K)),N=-X*X+G*(G+2*H)+U;else if(G<=-F)X=Math.max(0,-(-q*W+K)),G=X>0?-W:Math.min(Math.max(-W,-H),W),N=-X*X+G*(G+2*H)+U;else if(G<=F)X=0,G=Math.min(Math.max(-W,-H),W),N=G*(G+2*H)+U;else X=Math.max(0,-(q*W+K)),G=X>0?W:Math.min(Math.max(-W,-H),W),N=-X*X+G*(G+2*H)+U;else G=q>0?-W:W,X=Math.max(0,-(q*G+K)),N=-X*X+G*(G+2*H)+U;if($)$.copy(this.origin).addScaledVector(this.direction,X);if(Z)Z.copy(q1).addScaledVector(v0,G);return N}intersectSphere(J,Q){if(J.radius<0)return null;L7.subVectors(J.center,this.origin);let $=L7.dot(this.direction),Z=L7.dot(L7)-$*$,W=J.radius*J.radius;if(Z>W)return null;let q=Math.sqrt(W-Z),K=$-q,H=$+q;if(H<0)return null;if(K<0)return this.at(H,Q);return this.at(K,Q)}intersectsSphere(J){if(J.radius<0)return!1;return this.distanceSqToPoint(J.center)<=J.radius*J.radius}distanceToPlane(J){let Q=J.normal.dot(this.direction);if(Q===0){if(J.distanceToPoint(this.origin)===0)return 0;return null}let $=-(this.origin.dot(J.normal)+J.constant)/Q;return $>=0?$:null}intersectPlane(J,Q){let $=this.distanceToPlane(J);if($===null)return null;return this.at($,Q)}intersectsPlane(J){let Q=J.distanceToPoint(this.origin);if(Q===0)return!0;if(J.normal.dot(this.direction)*Q<0)return!0;return!1}intersectBox(J,Q){let $,Z,W,q,K,H,U=1/this.direction.x,Y=1/this.direction.y,X=1/this.direction.z,G=this.origin;if(U>=0)$=(J.min.x-G.x)*U,Z=(J.max.x-G.x)*U;else $=(J.max.x-G.x)*U,Z=(J.min.x-G.x)*U;if(Y>=0)W=(J.min.y-G.y)*Y,q=(J.max.y-G.y)*Y;else W=(J.max.y-G.y)*Y,q=(J.min.y-G.y)*Y;if($>q||W>Z)return null;if(W>$||isNaN($))$=W;if(q<Z||isNaN(Z))Z=q;if(X>=0)K=(J.min.z-G.z)*X,H=(J.max.z-G.z)*X;else K=(J.max.z-G.z)*X,H=(J.min.z-G.z)*X;if($>H||K>Z)return null;if(K>$||$!==$)$=K;if(H<Z||Z!==Z)Z=H;if(Z<0)return null;return this.at($>=0?$:Z,Q)}intersectsBox(J){return this.intersectBox(J,L7)!==null}intersectTriangle(J,Q,$,Z,W){let q=this.origin,K=this.direction,H=K.x,U=K.y,Y=K.z,X=J.x-q.x,G=J.y-q.y,N=J.z-q.z,F=Q.x-q.x,M=Q.y-q.y,L=Q.z-q.z,E=$.x-q.x,O=$.y-q.y,_=$.z-q.z,V=Math.abs(H),B=Math.abs(U),w=Math.abs(Y),y,D,z,m,t,v,J8,E8,T,H8,e,S;if(V>=B&&V>=w)if(z=H,v=X,T=F,S=E,H>=0)y=U,D=Y,m=G,t=N,J8=M,E8=L,H8=O,e=_;else y=Y,D=U,m=N,t=G,J8=L,E8=M,H8=_,e=O;else if(B>=w)if(z=U,v=G,T=M,S=O,U>=0)y=Y,D=H,m=N,t=X,J8=L,E8=F,H8=_,e=E;else y=H,D=Y,m=X,t=N,J8=F,E8=L,H8=E,e=_;else if(z=Y,v=N,T=L,S=_,Y>=0)y=H,D=U,m=X,t=G,J8=F,E8=M,H8=E,e=O;else y=U,D=H,m=G,t=X,J8=M,E8=F,H8=O,e=E;if(z===0)return null;let B8=y/z,i=D/z,X8=1/z,V8=m-B8*v,v8=t-i*v,U8=J8-B8*T,M8=E8-i*T,b8=H8-B8*S,n=e-i*S,d=b8*M8-n*U8,P=V8*n-v8*b8,C=U8*v8-M8*V8;if(Z){if(d<0||P<0||C<0)return null}else if((d<0||P<0||C<0)&&(d>0||P>0||C>0))return null;let g=d+P+C;if(g===0)return null;let K8=X8*(d*v+P*T+C*S);if(g>0?K8<0:K8>0)return null;return this.at(K8/g,W)}applyMatrix4(J){return this.origin.applyMatrix4(J),this.direction.transformDirection(J),this}equals(J){return J.origin.equals(this.origin)&&J.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class b9 extends h7{constructor(J){super();this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new r8(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Y7,this.combine=0,this.reflectivity=1,this.refractionRatio=0.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.map=J.map,this.lightMap=J.lightMap,this.lightMapIntensity=J.lightMapIntensity,this.aoMap=J.aoMap,this.aoMapIntensity=J.aoMapIntensity,this.specularMap=J.specularMap,this.alphaMap=J.alphaMap,this.envMap=J.envMap,this.envMapRotation.copy(J.envMapRotation),this.combine=J.combine,this.reflectivity=J.reflectivity,this.refractionRatio=J.refractionRatio,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.wireframeLinecap=J.wireframeLinecap,this.wireframeLinejoin=J.wireframeLinejoin,this.fog=J.fog,this}}var VQ=new G6,c7=new VJ,b0=new Q9,IQ=new u,h0=new u,x0=new u,g0=new u,K1=new u,p0=new u,AQ=new u,m0=new u;class M6 extends z6{constructor(J=new $7,Q=new b9){super();this.isMesh=!0,this.type="Mesh",this.geometry=J,this.material=Q,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(J,Q){if(super.copy(J,Q),J.morphTargetInfluences!==void 0)this.morphTargetInfluences=J.morphTargetInfluences.slice();else this.morphTargetInfluences=void 0;if(J.morphTargetDictionary!==void 0)this.morphTargetDictionary=Object.assign({},J.morphTargetDictionary);else this.morphTargetDictionary=void 0;return this.material=Array.isArray(J.material)?J.material.slice():J.material,this.geometry=J.geometry,this}updateMorphTargets(){let Q=this.geometry.morphAttributes,$=Object.keys(Q);if($.length>0){let Z=Q[$[0]];if(Z!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let W=0,q=Z.length;W<q;W++){let K=Z[W].name||String(W);this.morphTargetInfluences.push(0),this.morphTargetDictionary[K]=W}}}}getVertexPosition(J,Q){let $=this.geometry,Z=$.attributes.position,W=$.morphAttributes.position,q=$.morphTargetsRelative;Q.fromBufferAttribute(Z,J);let K=this.morphTargetInfluences;if(W&&K){p0.set(0,0,0);for(let H=0,U=W.length;H<U;H++){let Y=K[H],X=W[H];if(Y===0)continue;if(K1.fromBufferAttribute(X,J),q)p0.addScaledVector(K1,Y);else p0.addScaledVector(K1.sub(Q),Y)}Q.add(p0)}return Q}intersectsFrustum(J){return J.intersectsObject(this)}raycast(J,Q){let $=this.geometry,Z=this.material,W=this.matrixWorld;if(Z===void 0)return;if($.boundingSphere===null)$.computeBoundingSphere();if(b0.copy($.boundingSphere),b0.applyMatrix4(W),c7.copy(J.ray).recast(J.near),b0.containsPoint(c7.origin)===!1){if(c7.intersectSphere(b0,IQ)===null)return;if(c7.origin.distanceToSquared(IQ)>(J.far-J.near)**2)return}if(VQ.copy(W).invert(),c7.copy(J.ray).applyMatrix4(VQ),$.boundingBox!==null){if(c7.intersectsBox($.boundingBox)===!1)return}this._computeIntersections(J,Q,c7)}_computeIntersections(J,Q,$){let Z,W=this.geometry,q=this.material,K=W.index,H=W.attributes.position,U=W.attributes.uv,Y=W.attributes.uv1,X=W.attributes.normal,G=W.groups,N=W.drawRange;if(K!==null)if(Array.isArray(q))for(let F=0,M=G.length;F<M;F++){let L=G[F],E=q[L.materialIndex],O=Math.max(L.start,N.start),_=Math.min(K.count,Math.min(L.start+L.count,N.start+N.count));for(let V=O,B=_;V<B;V+=3){let w=K.getX(V),y=K.getX(V+1),D=K.getX(V+2);if(Z=l0(this,E,J,$,U,Y,X,w,y,D),Z)Z.faceIndex=Math.floor(V/3),Z.face.materialIndex=L.materialIndex,Q.push(Z)}}else{let F=Math.max(0,N.start),M=Math.min(K.count,N.start+N.count);for(let L=F,E=M;L<E;L+=3){let O=K.getX(L),_=K.getX(L+1),V=K.getX(L+2);if(Z=l0(this,q,J,$,U,Y,X,O,_,V),Z)Z.faceIndex=Math.floor(L/3),Q.push(Z)}}else if(H!==void 0)if(Array.isArray(q))for(let F=0,M=G.length;F<M;F++){let L=G[F],E=q[L.materialIndex],O=Math.max(L.start,N.start),_=Math.min(H.count,Math.min(L.start+L.count,N.start+N.count));for(let V=O,B=_;V<B;V+=3){let w=V,y=V+1,D=V+2;if(Z=l0(this,E,J,$,U,Y,X,w,y,D),Z)Z.faceIndex=Math.floor(V/3),Z.face.materialIndex=L.materialIndex,Q.push(Z)}}else{let F=Math.max(0,N.start),M=Math.min(H.count,N.start+N.count);for(let L=F,E=M;L<E;L+=3){let O=L,_=L+1,V=L+2;if(Z=l0(this,q,J,$,U,Y,X,O,_,V),Z)Z.faceIndex=Math.floor(L/3),Q.push(Z)}}}}function vW(J,Q,$,Z,W,q,K,H){let U;if(Q.side===1)U=Z.intersectTriangle(K,q,W,!0,H);else U=Z.intersectTriangle(W,q,K,Q.side===0,H);if(U===null)return null;m0.copy(H),m0.applyMatrix4(J.matrixWorld);let Y=$.ray.origin.distanceTo(m0);if(Y<$.near||Y>$.far)return null;return{distance:Y,point:m0.clone(),object:J}}function l0(J,Q,$,Z,W,q,K,H,U,Y){J.getVertexPosition(H,h0),J.getVertexPosition(U,x0),J.getVertexPosition(Y,g0);let X=vW(J,Q,$,Z,h0,x0,g0,AQ);if(X){let G=new u;if(d6.getBarycoord(AQ,h0,x0,g0,G),W)X.uv=d6.getInterpolatedAttribute(W,H,U,Y,G,new L8);if(q)X.uv1=d6.getInterpolatedAttribute(q,H,U,Y,G,new L8);if(K){if(X.normal=d6.getInterpolatedAttribute(K,H,U,Y,G,new u),X.normal.dot(Z.direction)>0)X.normal.multiplyScalar(-1)}let N={a:H,b:U,c:Y,normal:new u,materialIndex:0};d6.getNormal(h0,x0,g0,N.normal),X.face=N,X.barycoord=G}return X}class h9 extends w6{constructor(J=null,Q=1,$=1,Z,W,q,K,H,U=1003,Y=1003,X,G){super(null,q,K,H,U,Y,Z,W,X,G);this.isDataTexture=!0,this.image={data:J,width:Q,height:$},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class a0 extends U7{constructor(J,Q,$,Z=1){super(J,Q,$);this.isInstancedBufferAttribute=!0,this.meshPerAttribute=Z}copy(J){return super.copy(J),this.meshPerAttribute=J.meshPerAttribute,this}toJSON(){let J=super.toJSON();return J.meshPerAttribute=this.meshPerAttribute,J.isInstancedBufferAttribute=!0,J}}var L9=new G6,_Q=new G6,d0=[],CQ=new C7,fW=new G6,i9=new M6,o9=new Q9;class E5 extends M6{constructor(J,Q,$){super(J,Q);this.isInstancedMesh=!0,this.instanceMatrix=new a0(new Float32Array($*16),16),this.instanceColor=null,this.morphTexture=null,this.count=$,this.boundingBox=null,this.boundingSphere=null;for(let Z=0;Z<$;Z++)this.setMatrixAt(Z,fW)}computeBoundingBox(){let J=this.geometry,Q=this.count;if(this.boundingBox===null)this.boundingBox=new C7;if(J.boundingBox===null)J.computeBoundingBox();this.boundingBox.makeEmpty();for(let $=0;$<Q;$++)this.getMatrixAt($,L9),CQ.copy(J.boundingBox).applyMatrix4(L9),this.boundingBox.union(CQ)}computeBoundingSphere(){let J=this.geometry,Q=this.count;if(this.boundingSphere===null)this.boundingSphere=new Q9;if(J.boundingSphere===null)J.computeBoundingSphere();this.boundingSphere.makeEmpty();for(let $=0;$<Q;$++)this.getMatrixAt($,L9),o9.copy(J.boundingSphere).applyMatrix4(L9),this.boundingSphere.union(o9)}copy(J,Q){return super.copy(J,Q),this.instanceMatrix.copy(J.instanceMatrix),this.morphTexture=J.morphTexture!==null?J.morphTexture.clone():null,this.instanceColor=J.instanceColor!==null?J.instanceColor.clone():null,this.count=J.count,this.boundingBox=J.boundingBox!==null?J.boundingBox.clone():null,this.boundingSphere=J.boundingSphere!==null?J.boundingSphere.clone():null,this}getColorAt(J,Q){if(this.instanceColor===null)return Q.setRGB(1,1,1);else return Q.fromArray(this.instanceColor.array,J*3)}getMatrixAt(J,Q){return Q.fromArray(this.instanceMatrix.array,J*16)}getMorphAt(J,Q){let $=Q.morphTargetInfluences,Z=this.morphTexture.source.data.data,W=$.length+1,q=J*W+1;for(let K=0;K<$.length;K++)$[K]=Z[q+K]}raycast(J,Q){let $=this.matrixWorld,Z=this.count;if(i9.geometry=this.geometry,i9.material=this.material,i9.material===void 0)return;if(this.boundingSphere===null)this.computeBoundingSphere();if(o9.copy(this.boundingSphere),o9.applyMatrix4($),J.ray.intersectsSphere(o9)===!1)return;for(let W=0;W<Z;W++){this.getMatrixAt(W,L9),_Q.multiplyMatrices($,L9),i9.matrixWorld=_Q,i9.raycast(J,d0);for(let q=0,K=d0.length;q<K;q++){let H=d0[q];H.instanceId=W,H.object=this,Q.push(H)}d0.length=0}}setColorAt(J,Q){if(this.instanceColor===null)this.instanceColor=new a0(new Float32Array(this.instanceMatrix.count*3).fill(1),3);return Q.toArray(this.instanceColor.array,J*3),this}setMatrixAt(J,Q){return Q.toArray(this.instanceMatrix.array,J*16),this}setMorphAt(J,Q){let $=Q.morphTargetInfluences,Z=$.length+1;if(this.morphTexture===null)this.morphTexture=new h9(new Float32Array(Z*this.count),Z,this.count,1028,1015);let W=this.morphTexture.source.data.data,q=0;for(let U=0;U<$.length;U++)q+=$[U];let K=this.geometry.morphTargetsRelative?1:1-q,H=Z*J;return W[H]=K,W.set($,H+1),this}updateMorphTargets(){}dispose(){if(super.dispose(),this.instanceMatrix.dispose(),this.instanceColor!==null)this.instanceColor.dispose();if(this.morphTexture!==null)this.morphTexture.dispose(),this.morphTexture=null}}var n7=new Q9,bW=new L8(0.5,0.5),u0=new u;class i7{constructor(J=new q7,Q=new q7,$=new q7,Z=new q7,W=new q7,q=new q7){this.planes=[J,Q,$,Z,W,q]}set(J,Q,$,Z,W,q){let K=this.planes;return K[0].copy(J),K[1].copy(Q),K[2].copy($),K[3].copy(Z),K[4].copy(W),K[5].copy(q),this}copy(J){let Q=this.planes;for(let $=0;$<6;$++)Q[$].copy(J.planes[$]);return this}setFromProjectionMatrix(J,Q=2000,$=!1){let Z=this.planes,W=J.elements,q=W[0],K=W[1],H=W[2],U=W[3],Y=W[4],X=W[5],G=W[6],N=W[7],F=W[8],M=W[9],L=W[10],E=W[11],O=W[12],_=W[13],V=W[14],B=W[15];if(Z[0].setComponents(U-q,N-Y,E-F,B-O).normalize(),Z[1].setComponents(U+q,N+Y,E+F,B+O).normalize(),Z[2].setComponents(U+K,N+X,E+M,B+_).normalize(),Z[3].setComponents(U-K,N-X,E-M,B-_).normalize(),$)Z[4].setComponents(H,G,L,V).normalize(),Z[5].setComponents(U-H,N-G,E-L,B-V).normalize();else if(Z[4].setComponents(U-H,N-G,E-L,B-V).normalize(),Q===2000)Z[5].setComponents(U+H,N+G,E+L,B+V).normalize();else if(Q===2001)Z[5].setComponents(H,G,L,V).normalize();else throw Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+Q);return this}intersectsObject(J){if(J.boundingSphere!==void 0){if(J.boundingSphere===null)J.computeBoundingSphere();n7.copy(J.boundingSphere).applyMatrix4(J.matrixWorld)}else{let Q=J.geometry;if(Q.boundingSphere===null)Q.computeBoundingSphere();n7.copy(Q.boundingSphere).applyMatrix4(J.matrixWorld)}return this.intersectsSphere(n7)}intersectsSprite(J){n7.center.set(0,0,0);let Q=bW.distanceTo(J.center);return n7.radius=0.7071067811865476+Q,n7.applyMatrix4(J.matrixWorld),this.intersectsSphere(n7)}intersectsSphere(J){let Q=this.planes,$=J.center,Z=-J.radius;for(let W=0;W<6;W++)if(Q[W].distanceToPoint($)<Z)return!1;return!0}intersectsBox(J){let Q=this.planes;for(let $=0;$<6;$++){let Z=Q[$];if(u0.x=Z.normal.x>0?J.max.x:J.min.x,u0.y=Z.normal.y>0?J.max.y:J.min.y,u0.z=Z.normal.z>0?J.max.z:J.min.z,Z.distanceToPoint(u0)<0)return!1}return!0}containsPoint(J){let Q=this.planes;for(let $=0;$<6;$++)if(Q[$].distanceToPoint(J)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}var PQ=new G6;class F5{constructor(){this.coordinateSystem=2000,this._frustums=[],this._count=0}setFromArrayCamera(J){let Q=J.cameras,$=this._frustums;for(let Z=0;Z<Q.length;Z++){let W=Q[Z];if(PQ.multiplyMatrices(W.projectionMatrix,W.matrixWorldInverse),$[Z]===void 0)$[Z]=new i7;$[Z].setFromProjectionMatrix(PQ,W.coordinateSystem,W.reversedDepth)}return this._count=Q.length,this}getFrustum(J){return this._frustums[J]}intersectsObject(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].intersectsObject(J))return!0;return!1}intersectsSprite(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].intersectsSprite(J))return!0;return!1}intersectsSphere(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].intersectsSphere(J))return!0;return!1}intersectsBox(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].intersectsBox(J))return!0;return!1}containsPoint(J){let Q=this._frustums;for(let $=0;$<this._count;$++)if(Q[$].containsPoint(J))return!0;return!1}copy(J){this.coordinateSystem=J.coordinateSystem;let Q=this._frustums,$=J._frustums;for(let Z=0;Z<J._count;Z++){if(Q[Z]===void 0)Q[Z]=new i7;Q[Z].copy($[Z])}return this._count=J._count,this}clone(){return new F5().copy(this)}}class D5 extends w6{constructor(J=[],Q=301,$,Z,W,q,K,H,U,Y){super(J,Q,$,Z,W,q,K,H,U,Y);this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(J){this.image=J}}class O5 extends w6{constructor(J,Q,$,Z,W,q,K,H,U){super(J,Q,$,Z,W,q,K,H,U);this.isCanvasTexture=!0,this.needsUpdate=!0}}class x7 extends w6{constructor(J,Q,$=1014,Z,W,q,K=1003,H=1003,U,Y=1026,X=1){if(Y!==1026&&Y!==1027)throw Error("THREE.DepthTexture: format must be either THREE.DepthFormat or THREE.DepthStencilFormat");let G={width:J,height:Q,depth:X};super(G,Z,W,q,K,H,Y,$,U);this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(J){return super.copy(J),this.source=new G0(Object.assign({},J.image)),this.compareFunction=J.compareFunction,this}toJSON(J){let Q=super.toJSON(J);return Q.compareFunction=this.compareFunction,Q}}class R5 extends x7{constructor(J,Q=1014,$=301,Z,W,q=1003,K=1003,H,U=1026){let Y={width:J,height:J,depth:1},X=[Y,Y,Y,Y,Y,Y];super(J,J,Q,$,Z,W,q,K,H,U);this.image=X,this.isCubeDepthTexture=!0,this.isCubeTexture=!0}get images(){return this.image}set images(J){this.image=J}}class M5 extends w6{constructor(J=null){super();this.sourceTexture=J,this.isExternalTexture=!0}copy(J){return super.copy(J),this.sourceTexture=J.sourceTexture,this}}class g7 extends $7{constructor(J=1,Q=1,$=1,Z=1,W=1,q=1){super();this.type="BoxGeometry",this.parameters={width:J,height:Q,depth:$,widthSegments:Z,heightSegments:W,depthSegments:q};let K=this;Z=Math.floor(Z),W=Math.floor(W),q=Math.floor(q);let H=[],U=[],Y=[],X=[],G=0,N=0;F("z","y","x",-1,-1,$,Q,J,q,W,0),F("z","y","x",1,-1,$,Q,-J,q,W,1),F("x","z","y",1,1,J,$,Q,Z,q,2),F("x","z","y",1,-1,J,$,-Q,Z,q,3),F("x","y","z",1,-1,J,Q,$,Z,W,4),F("x","y","z",-1,-1,J,Q,-$,Z,W,5),this.setIndex(H),this.setAttribute("position",new T6(U,3)),this.setAttribute("normal",new T6(Y,3)),this.setAttribute("uv",new T6(X,2));function F(M,L,E,O,_,V,B,w,y,D,z){let m=V/y,t=B/D,v=V/2,J8=B/2,E8=w/2,T=y+1,H8=D+1,e=0,S=0,B8=new u;for(let i=0;i<H8;i++){let X8=i*t-J8;for(let V8=0;V8<T;V8++){let v8=V8*m-v;B8[M]=v8*O,B8[L]=X8*_,B8[E]=E8,U.push(B8.x,B8.y,B8.z),B8[M]=0,B8[L]=0,B8[E]=w>0?1:-1,Y.push(B8.x,B8.y,B8.z),X.push(V8/y),X.push(1-i/D),e+=1}}for(let i=0;i<D;i++)for(let X8=0;X8<y;X8++){let V8=G+X8+T*i,v8=G+X8+T*(i+1),U8=G+(X8+1)+T*(i+1),M8=G+(X8+1)+T*i;H.push(V8,v8,M8),H.push(v8,U8,M8),S+=6}K.addGroup(N,S,z),N+=S,G+=e}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new g7(J.width,J.height,J.depth,J.widthSegments,J.heightSegments,J.depthSegments)}}class n6{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){t8("Curve: .getPoint() not implemented.")}getPointAt(J,Q){let $=this.getUtoTmapping(J);return this.getPoint($,Q)}getPoints(J=5){let Q=[];for(let $=0;$<=J;$++)Q.push(this.getPoint($/J));return Q}getSpacedPoints(J=5){let Q=[];for(let $=0;$<=J;$++)Q.push(this.getPointAt($/J));return Q}getLength(){let J=this.getLengths();return J[J.length-1]}getLengths(J=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===J+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;let Q=[],$,Z=this.getPoint(0),W=0;Q.push(0);for(let q=1;q<=J;q++)$=this.getPoint(q/J),W+=$.distanceTo(Z),Q.push(W),Z=$;return this.cacheArcLengths=Q,Q}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(J,Q=null){let $=this.getLengths(),Z=0,W=$.length,q;if(Q)q=Q;else q=J*$[W-1];let K=0,H=W-1,U;while(K<=H)if(Z=Math.floor(K+(H-K)/2),U=$[Z]-q,U<0)K=Z+1;else if(U>0)H=Z-1;else{H=Z;break}if(Z=H,$[Z]===q)return Z/(W-1);let Y=$[Z],G=$[Z+1]-Y,N=(q-Y)/G;return(Z+N)/(W-1)}getTangent(J,Q){let Z=J-0.0001,W=J+0.0001;if(Z<0)Z=0;if(W>1)W=1;let q=this.getPoint(Z),K=this.getPoint(W),H=Q||(q.isVector2?new L8:new u);return H.copy(K).sub(q).normalize(),H}getTangentAt(J,Q){let $=this.getUtoTmapping(J);return this.getTangent($,Q)}computeFrenetFrames(J,Q=!1){let $=new u,Z=[],W=[],q=[],K=new u,H=new G6;for(let N=0;N<=J;N++){let F=N/J;Z[N]=this.getTangentAt(F,new u)}W[0]=new u,q[0]=new u;let U=Number.MAX_VALUE,Y=Math.abs(Z[0].x),X=Math.abs(Z[0].y),G=Math.abs(Z[0].z);if(Y<=U)U=Y,$.set(1,0,0);if(X<=U)U=X,$.set(0,1,0);if(G<=U)$.set(0,0,1);K.crossVectors(Z[0],$).normalize(),W[0].crossVectors(Z[0],K),q[0].crossVectors(Z[0],W[0]);for(let N=1;N<=J;N++){if(W[N]=W[N-1].clone(),q[N]=q[N-1].clone(),K.crossVectors(Z[N-1],Z[N]),K.length()>Number.EPSILON){K.normalize();let F=Math.acos(Z6(Z[N-1].dot(Z[N]),-1,1));W[N].applyMatrix4(H.makeRotationAxis(K,F))}q[N].crossVectors(Z[N],W[N])}if(Q===!0){let N=Math.acos(Z6(W[0].dot(W[J]),-1,1));if(N/=J,Z[0].dot(K.crossVectors(W[0],W[J]))>0)N=-N;for(let F=1;F<=J;F++)W[F].applyMatrix4(H.makeRotationAxis(Z[F],N*F)),q[F].crossVectors(Z[F],W[F])}return{tangents:Z,normals:W,binormals:q}}clone(){return new this.constructor().copy(this)}copy(J){return this.arcLengthDivisions=J.arcLengthDivisions,this.cacheArcLengths=null,this}toJSON(){let J={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return J.arcLengthDivisions=this.arcLengthDivisions,J.type=this.type,J}fromJSON(J){return this.arcLengthDivisions=J.arcLengthDivisions,this.cacheArcLengths=null,this}}class E0 extends n6{constructor(J=0,Q=0,$=1,Z=1,W=0,q=Math.PI*2,K=!1,H=0){super();this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=J,this.aY=Q,this.xRadius=$,this.yRadius=Z,this.aStartAngle=W,this.aEndAngle=q,this.aClockwise=K,this.aRotation=H}getPoint(J,Q=new L8){let $=Q,Z=Math.PI*2,W=this.aEndAngle-this.aStartAngle,q=Math.abs(W)<Number.EPSILON;while(W<0)W+=Z;while(W>Z)W-=Z;if(W<Number.EPSILON)if(q)W=0;else W=Z;if(this.aClockwise===!0&&!q)if(W===Z)W=-Z;else W=W-Z;let K=this.aStartAngle+J*W,H=this.aX+this.xRadius*Math.cos(K),U=this.aY+this.yRadius*Math.sin(K);if(this.aRotation!==0){let Y=Math.cos(this.aRotation),X=Math.sin(this.aRotation),G=H-this.aX,N=U-this.aY;H=G*Y-N*X+this.aX,U=G*X+N*Y+this.aY}return $.set(H,U)}copy(J){return super.copy(J),this.aX=J.aX,this.aY=J.aY,this.xRadius=J.xRadius,this.yRadius=J.yRadius,this.aStartAngle=J.aStartAngle,this.aEndAngle=J.aEndAngle,this.aClockwise=J.aClockwise,this.aRotation=J.aRotation,this}toJSON(){let J=super.toJSON();return J.aX=this.aX,J.aY=this.aY,J.xRadius=this.xRadius,J.yRadius=this.yRadius,J.aStartAngle=this.aStartAngle,J.aEndAngle=this.aEndAngle,J.aClockwise=this.aClockwise,J.aRotation=this.aRotation,J}fromJSON(J){return super.fromJSON(J),this.aX=J.aX,this.aY=J.aY,this.xRadius=J.xRadius,this.yRadius=J.yRadius,this.aStartAngle=J.aStartAngle,this.aEndAngle=J.aEndAngle,this.aClockwise=J.aClockwise,this.aRotation=J.aRotation,this}}class IJ extends E0{constructor(J,Q,$,Z,W,q){super(J,Q,$,$,Z,W,q);this.isArcCurve=!0,this.type="ArcCurve"}}function AJ(){let J=0,Q=0,$=0,Z=0;function W(q,K,H,U){J=q,Q=H,$=-3*q+3*K-2*H-U,Z=2*q-2*K+H+U}return{initCatmullRom:function(q,K,H,U,Y){W(K,H,Y*(H-q),Y*(U-K))},initNonuniformCatmullRom:function(q,K,H,U,Y,X,G){let N=(K-q)/Y-(H-q)/(Y+X)+(H-K)/X,F=(H-K)/X-(U-K)/(X+G)+(U-H)/G;N*=X,F*=X,W(K,H,N,F)},calc:function(q){let K=q*q,H=K*q;return J+Q*q+$*K+Z*H}}}var wQ=new u,TQ=new u,H1=new AJ,U1=new AJ,Y1=new AJ;class _J extends n6{constructor(J=[],Q=!1,$="centripetal",Z=0.5){super();this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=J,this.closed=Q,this.curveType=$,this.tension=Z}getPoint(J,Q=new u){let $=Q,Z=this.points,W=Z.length,q=(W-(this.closed?0:1))*J,K=Math.floor(q),H=q-K;if(this.closed)K+=K>0?0:(Math.floor(Math.abs(K)/W)+1)*W;else if(H===0&&K===W-1)K=W-2,H=1;let U,Y;if(this.closed||K>0)U=Z[(K-1)%W];else TQ.subVectors(Z[0],Z[1]).add(Z[0]),U=TQ;let X=Z[K%W],G=Z[(K+1)%W];if(this.closed||K+2<W)Y=Z[(K+2)%W];else wQ.subVectors(Z[W-1],Z[W-2]).add(Z[W-1]),Y=wQ;if(this.curveType==="centripetal"||this.curveType==="chordal"){let N=this.curveType==="chordal"?0.5:0.25,F=Math.pow(U.distanceToSquared(X),N),M=Math.pow(X.distanceToSquared(G),N),L=Math.pow(G.distanceToSquared(Y),N);if(M<0.0001)M=1;if(F<0.0001)F=M;if(L<0.0001)L=M;H1.initNonuniformCatmullRom(U.x,X.x,G.x,Y.x,F,M,L),U1.initNonuniformCatmullRom(U.y,X.y,G.y,Y.y,F,M,L),Y1.initNonuniformCatmullRom(U.z,X.z,G.z,Y.z,F,M,L)}else if(this.curveType==="catmullrom")H1.initCatmullRom(U.x,X.x,G.x,Y.x,this.tension),U1.initCatmullRom(U.y,X.y,G.y,Y.y,this.tension),Y1.initCatmullRom(U.z,X.z,G.z,Y.z,this.tension);return $.set(H1.calc(H),U1.calc(H),Y1.calc(H)),$}copy(J){super.copy(J),this.points=[];for(let Q=0,$=J.points.length;Q<$;Q++){let Z=J.points[Q];this.points.push(Z.clone())}return this.closed=J.closed,this.curveType=J.curveType,this.tension=J.tension,this}toJSON(){let J=super.toJSON();J.points=[];for(let Q=0,$=this.points.length;Q<$;Q++){let Z=this.points[Q];J.points.push(Z.toArray())}return J.closed=this.closed,J.curveType=this.curveType,J.tension=this.tension,J}fromJSON(J){super.fromJSON(J),this.points=[];for(let Q=0,$=J.points.length;Q<$;Q++){let Z=J.points[Q];this.points.push(new u().fromArray(Z))}return this.closed=J.closed,this.curveType=J.curveType,this.tension=J.tension,this}}function SQ(J,Q,$,Z,W){let q=(Z-Q)*0.5,K=(W-$)*0.5,H=J*J,U=J*H;return(2*$-2*Z+q+K)*U+(-3*$+3*Z-2*q-K)*H+q*J+$}function hW(J,Q){let $=1-J;return $*$*Q}function xW(J,Q){return 2*(1-J)*J*Q}function gW(J,Q){return J*J*Q}function e9(J,Q,$,Z){return hW(J,Q)+xW(J,$)+gW(J,Z)}function pW(J,Q){let $=1-J;return $*$*$*Q}function mW(J,Q){let $=1-J;return 3*$*$*J*Q}function lW(J,Q){return 3*(1-J)*J*J*Q}function dW(J,Q){return J*J*J*Q}function J0(J,Q,$,Z,W){return pW(J,Q)+mW(J,$)+lW(J,Z)+dW(J,W)}class k5 extends n6{constructor(J=new L8,Q=new L8,$=new L8,Z=new L8){super();this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=J,this.v1=Q,this.v2=$,this.v3=Z}getPoint(J,Q=new L8){let $=Q,Z=this.v0,W=this.v1,q=this.v2,K=this.v3;return $.set(J0(J,Z.x,W.x,q.x,K.x),J0(J,Z.y,W.y,q.y,K.y)),$}copy(J){return super.copy(J),this.v0.copy(J.v0),this.v1.copy(J.v1),this.v2.copy(J.v2),this.v3.copy(J.v3),this}toJSON(){let J=super.toJSON();return J.v0=this.v0.toArray(),J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J.v3=this.v3.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v0.fromArray(J.v0),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this.v3.fromArray(J.v3),this}}class CJ extends n6{constructor(J=new u,Q=new u,$=new u,Z=new u){super();this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=J,this.v1=Q,this.v2=$,this.v3=Z}getPoint(J,Q=new u){let $=Q,Z=this.v0,W=this.v1,q=this.v2,K=this.v3;return $.set(J0(J,Z.x,W.x,q.x,K.x),J0(J,Z.y,W.y,q.y,K.y),J0(J,Z.z,W.z,q.z,K.z)),$}copy(J){return super.copy(J),this.v0.copy(J.v0),this.v1.copy(J.v1),this.v2.copy(J.v2),this.v3.copy(J.v3),this}toJSON(){let J=super.toJSON();return J.v0=this.v0.toArray(),J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J.v3=this.v3.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v0.fromArray(J.v0),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this.v3.fromArray(J.v3),this}}class L5 extends n6{constructor(J=new L8,Q=new L8){super();this.isLineCurve=!0,this.type="LineCurve",this.v1=J,this.v2=Q}getPoint(J,Q=new L8){let $=Q;if(J===1)$.copy(this.v2);else $.copy(this.v2).sub(this.v1),$.multiplyScalar(J).add(this.v1);return $}getPointAt(J,Q){return this.getPoint(J,Q)}getTangent(J,Q=new L8){return Q.subVectors(this.v2,this.v1).normalize()}getTangentAt(J,Q){return this.getTangent(J,Q)}copy(J){return super.copy(J),this.v1.copy(J.v1),this.v2.copy(J.v2),this}toJSON(){let J=super.toJSON();return J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this}}class PJ extends n6{constructor(J=new u,Q=new u){super();this.isLineCurve3=!0,this.type="LineCurve3",this.v1=J,this.v2=Q}getPoint(J,Q=new u){let $=Q;if(J===1)$.copy(this.v2);else $.copy(this.v2).sub(this.v1),$.multiplyScalar(J).add(this.v1);return $}getPointAt(J,Q){return this.getPoint(J,Q)}getTangent(J,Q=new u){return Q.subVectors(this.v2,this.v1).normalize()}getTangentAt(J,Q){return this.getTangent(J,Q)}copy(J){return super.copy(J),this.v1.copy(J.v1),this.v2.copy(J.v2),this}toJSON(){let J=super.toJSON();return J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this}}class B5 extends n6{constructor(J=new L8,Q=new L8,$=new L8){super();this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=J,this.v1=Q,this.v2=$}getPoint(J,Q=new L8){let $=Q,Z=this.v0,W=this.v1,q=this.v2;return $.set(e9(J,Z.x,W.x,q.x),e9(J,Z.y,W.y,q.y)),$}copy(J){return super.copy(J),this.v0.copy(J.v0),this.v1.copy(J.v1),this.v2.copy(J.v2),this}toJSON(){let J=super.toJSON();return J.v0=this.v0.toArray(),J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v0.fromArray(J.v0),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this}}class wJ extends n6{constructor(J=new u,Q=new u,$=new u){super();this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=J,this.v1=Q,this.v2=$}getPoint(J,Q=new u){let $=Q,Z=this.v0,W=this.v1,q=this.v2;return $.set(e9(J,Z.x,W.x,q.x),e9(J,Z.y,W.y,q.y),e9(J,Z.z,W.z,q.z)),$}copy(J){return super.copy(J),this.v0.copy(J.v0),this.v1.copy(J.v1),this.v2.copy(J.v2),this}toJSON(){let J=super.toJSON();return J.v0=this.v0.toArray(),J.v1=this.v1.toArray(),J.v2=this.v2.toArray(),J}fromJSON(J){return super.fromJSON(J),this.v0.fromArray(J.v0),this.v1.fromArray(J.v1),this.v2.fromArray(J.v2),this}}class z5 extends n6{constructor(J=[]){super();this.isSplineCurve=!0,this.type="SplineCurve",this.points=J}getPoint(J,Q=new L8){let $=Q,Z=this.points,W=(Z.length-1)*J,q=Math.floor(W),K=W-q,H=Z[q===0?q:q-1],U=Z[q],Y=Z[q>Z.length-2?Z.length-1:q+1],X=Z[q>Z.length-3?Z.length-1:q+2];return $.set(SQ(K,H.x,U.x,Y.x,X.x),SQ(K,H.y,U.y,Y.y,X.y)),$}copy(J){super.copy(J),this.points=[];for(let Q=0,$=J.points.length;Q<$;Q++){let Z=J.points[Q];this.points.push(Z.clone())}return this}toJSON(){let J=super.toJSON();J.points=[];for(let Q=0,$=this.points.length;Q<$;Q++){let Z=this.points[Q];J.points.push(Z.toArray())}return J}fromJSON(J){super.fromJSON(J),this.points=[];for(let Q=0,$=J.points.length;Q<$;Q++){let Z=J.points[Q];this.points.push(new L8().fromArray(Z))}return this}}var G1=Object.freeze({__proto__:null,ArcCurve:IJ,CatmullRomCurve3:_J,CubicBezierCurve:k5,CubicBezierCurve3:CJ,EllipseCurve:E0,LineCurve:L5,LineCurve3:PJ,QuadraticBezierCurve:B5,QuadraticBezierCurve3:wJ,SplineCurve:z5});class TJ extends n6{constructor(){super();this.type="CurvePath",this.curves=[],this.autoClose=!1,this.cacheLengths=null}add(J){this.curves.push(J)}closePath(){let J=this.curves[0].getPoint(0),Q=this.curves[this.curves.length-1].getPoint(1);if(!J.equals(Q)){let $=J.isVector2===!0?"LineCurve":"LineCurve3";this.curves.push(new G1[$](Q,J))}return this}getPoint(J,Q){let $=J*this.getLength(),Z=this.getCurveLengths(),W=0;while(W<Z.length){if(Z[W]>=$){let q=Z[W]-$,K=this.curves[W],H=K.getLength(),U=H===0?0:1-q/H;return K.getPointAt(U,Q)}W++}return null}getLength(){let J=this.getCurveLengths();return J[J.length-1]}updateArcLengths(){this.needsUpdate=!0,this.cacheLengths=null,this.getCurveLengths()}getCurveLengths(){if(this.cacheLengths&&this.cacheLengths.length===this.curves.length)return this.cacheLengths;let J=[],Q=0;for(let $=0,Z=this.curves.length;$<Z;$++)Q+=this.curves[$].getLength(),J.push(Q);return this.cacheLengths=J,J}getSpacedPoints(J=40){let Q=[];for(let $=0;$<=J;$++)Q.push(this.getPoint($/J));if(this.autoClose)Q.push(Q[0]);return Q}getPoints(J=12){let Q=[],$;for(let Z=0,W=this.curves;Z<W.length;Z++){let q=W[Z],K=q.isEllipseCurve?J*2:q.isLineCurve||q.isLineCurve3?1:q.isSplineCurve?J*q.points.length:J,H=q.getPoints(K);for(let U=0;U<H.length;U++){let Y=H[U];if($&&$.equals(Y))continue;Q.push(Y),$=Y}}if(this.autoClose&&Q.length>1&&!Q[Q.length-1].equals(Q[0]))Q.push(Q[0]);return Q}copy(J){super.copy(J),this.curves=[];for(let Q=0,$=J.curves.length;Q<$;Q++){let Z=J.curves[Q];this.curves.push(Z.clone())}return this.autoClose=J.autoClose,this.cacheLengths=null,this}toJSON(){let J=super.toJSON();J.autoClose=this.autoClose,J.curves=[];for(let Q=0,$=this.curves.length;Q<$;Q++){let Z=this.curves[Q];J.curves.push(Z.toJSON())}return J}fromJSON(J){super.fromJSON(J),this.autoClose=J.autoClose,this.curves=[];for(let Q=0,$=J.curves.length;Q<$;Q++){let Z=J.curves[Q];this.curves.push(new G1[Z.type]().fromJSON(Z))}return this.cacheLengths=null,this}}class V7 extends TJ{constructor(J){super();if(this.type="Path",this.currentPoint=new L8,J)this.setFromPoints(J)}setFromPoints(J){this.moveTo(J[0].x,J[0].y);for(let Q=1,$=J.length;Q<$;Q++)this.lineTo(J[Q].x,J[Q].y);return this}moveTo(J,Q){return this.currentPoint.set(J,Q),this}lineTo(J,Q){let $=new L5(this.currentPoint.clone(),new L8(J,Q));return this.curves.push($),this.currentPoint.set(J,Q),this}quadraticCurveTo(J,Q,$,Z){let W=new B5(this.currentPoint.clone(),new L8(J,Q),new L8($,Z));return this.curves.push(W),this.currentPoint.set($,Z),this}bezierCurveTo(J,Q,$,Z,W,q){let K=new k5(this.currentPoint.clone(),new L8(J,Q),new L8($,Z),new L8(W,q));return this.curves.push(K),this.currentPoint.set(W,q),this}splineThru(J){let Q=[this.currentPoint.clone()].concat(J),$=new z5(Q);return this.curves.push($),this.currentPoint.copy(J[J.length-1]),this}arc(J,Q,$,Z,W,q){let K=this.currentPoint.x,H=this.currentPoint.y;return this.absarc(J+K,Q+H,$,Z,W,q),this}absarc(J,Q,$,Z,W,q){return this.absellipse(J,Q,$,$,Z,W,q),this}ellipse(J,Q,$,Z,W,q,K,H){let U=this.currentPoint.x,Y=this.currentPoint.y;return this.absellipse(J+U,Q+Y,$,Z,W,q,K,H),this}absellipse(J,Q,$,Z,W,q,K,H){let U=new E0(J,Q,$,Z,W,q,K,H);if(this.curves.length>0){let X=U.getPoint(0);if(!X.equals(this.currentPoint))this.lineTo(X.x,X.y)}this.curves.push(U);let Y=U.getPoint(1);return this.currentPoint.copy(Y),this}copy(J){return super.copy(J),this.currentPoint.copy(J.currentPoint),this}toJSON(){let J=super.toJSON();return J.currentPoint=this.currentPoint.toArray(),J}fromJSON(J){return super.fromJSON(J),this.currentPoint.fromArray(J.currentPoint),this}}class V5 extends V7{constructor(J){super(J);this.uuid=J9(),this.type="Shape",this.holes=[]}getPointsHoles(J){let Q=[];for(let $=0,Z=this.holes.length;$<Z;$++)Q[$]=this.holes[$].getPoints(J);return Q}extractPoints(J){return{shape:this.getPoints(J),holes:this.getPointsHoles(J)}}copy(J){super.copy(J),this.holes=[];for(let Q=0,$=J.holes.length;Q<$;Q++){let Z=J.holes[Q];this.holes.push(Z.clone())}return this}toJSON(){let J=super.toJSON();J.uuid=this.uuid,J.holes=[];for(let Q=0,$=this.holes.length;Q<$;Q++){let Z=this.holes[Q];J.holes.push(Z.toJSON())}return J}fromJSON(J){super.fromJSON(J),this.uuid=J.uuid,this.holes=[];for(let Q=0,$=J.holes.length;Q<$;Q++){let Z=J.holes[Q];this.holes.push(new V7().fromJSON(Z))}return this}}function uW(J,Q,$=2){let Z=Q&&Q.length,W=Z?Q[0]*$:J.length,q=c$(J,0,W,$,!0),K=[];if(!q||q.next===q.prev)return K;let H,U,Y;if(Z)q=oW(J,Q,q,$);if(J.length>80*$){H=J[0],U=J[1];let X=H,G=U;for(let N=$;N<W;N+=$){let F=J[N],M=J[N+1];if(F<H)H=F;if(M<U)U=M;if(F>X)X=F;if(M>G)G=M}Y=Math.max(X-H,G-U),Y=Y!==0?32767/Y:0}return $0(q,K,$,H,U,Y,0),K}function c$(J,Q,$,Z,W){let q;if(W===Kq(J,Q,$,Z)>0)for(let K=Q;K<$;K+=Z)q=jQ(K/Z|0,J[K],J[K+1],q);else for(let K=$-Z;K>=Q;K-=Z)q=jQ(K/Z|0,J[K],J[K+1],q);if(q&&C9(q,q.next))W0(q),q=q.next;return q}function o7(J,Q){if(!J)return J;if(!Q)Q=J;let $=J,Z;do if(Z=!1,!$.steiner&&(C9($,$.next)||O6($.prev,$,$.next)===0)){if(W0($),$=Q=$.prev,$===$.next)break;Z=!0}else $=$.next;while(Z||$!==Q);return Q}function $0(J,Q,$,Z,W,q,K){if(!J)return;if(!K&&q)Jq(J,Z,W,q);let H=J;while(J.prev!==J.next){let{prev:U,next:Y}=J;if(q?nW(J,Z,W,q):cW(J)){Q.push(U.i,J.i,Y.i),W0(J),J=Y.next,H=Y.next;continue}if(J=Y,J===H){if(!K)$0(o7(J),Q,$,Z,W,q,1);else if(K===1)J=sW(o7(J),Q),$0(J,Q,$,Z,W,q,2);else if(K===2)iW(J,Q,$,Z,W,q);break}}}function cW(J){let Q=J.prev,$=J,Z=J.next;if(O6(Q,$,Z)>=0)return!1;let W=Q.x,q=$.x,K=Z.x,H=Q.y,U=$.y,Y=Z.y,X=Math.min(W,q,K),G=Math.min(H,U,Y),N=Math.max(W,q,K),F=Math.max(H,U,Y),M=Z.next;while(M!==Q){if(M.x>=X&&M.x<=N&&M.y>=G&&M.y<=F&&a9(W,H,q,U,K,Y,M.x,M.y)&&O6(M.prev,M,M.next)>=0)return!1;M=M.next}return!0}function nW(J,Q,$,Z){let W=J.prev,q=J,K=J.next;if(O6(W,q,K)>=0)return!1;let H=W.x,U=q.x,Y=K.x,X=W.y,G=q.y,N=K.y,F=Math.min(H,U,Y),M=Math.min(X,G,N),L=Math.max(H,U,Y),E=Math.max(X,G,N),O=N1(F,M,Q,$,Z),_=N1(L,E,Q,$,Z),V=J.prevZ,B=J.nextZ;while(V&&V.z>=O&&B&&B.z<=_){if(V.x>=F&&V.x<=L&&V.y>=M&&V.y<=E&&V!==W&&V!==K&&a9(H,X,U,G,Y,N,V.x,V.y)&&O6(V.prev,V,V.next)>=0)return!1;if(V=V.prevZ,B.x>=F&&B.x<=L&&B.y>=M&&B.y<=E&&B!==W&&B!==K&&a9(H,X,U,G,Y,N,B.x,B.y)&&O6(B.prev,B,B.next)>=0)return!1;B=B.nextZ}while(V&&V.z>=O){if(V.x>=F&&V.x<=L&&V.y>=M&&V.y<=E&&V!==W&&V!==K&&a9(H,X,U,G,Y,N,V.x,V.y)&&O6(V.prev,V,V.next)>=0)return!1;V=V.prevZ}while(B&&B.z<=_){if(B.x>=F&&B.x<=L&&B.y>=M&&B.y<=E&&B!==W&&B!==K&&a9(H,X,U,G,Y,N,B.x,B.y)&&O6(B.prev,B,B.next)>=0)return!1;B=B.nextZ}return!0}function sW(J,Q){let $=J;do{let Z=$.prev,W=$.next.next;if(!C9(Z,W)&&s$(Z,$,$.next,W)&&Z0(Z,W)&&Z0(W,Z))Q.push(Z.i,$.i,W.i),W0($),W0($.next),$=J=W;$=$.next}while($!==J);return o7($)}function iW(J,Q,$,Z,W,q){let K=J;do{let H=K.next.next;while(H!==K.prev){if(K.i!==H.i&&Zq(K,H)){let U=i$(K,H);K=o7(K,K.next),U=o7(U,U.next),$0(K,Q,$,Z,W,q,0),$0(U,Q,$,Z,W,q,0);return}H=H.next}K=K.next}while(K!==J)}function oW(J,Q,$,Z){let W=[];for(let q=0,K=Q.length;q<K;q++){let H=Q[q]*Z,U=q<K-1?Q[q+1]*Z:J.length,Y=c$(J,H,U,Z,!1);if(Y===Y.next)Y.steiner=!0;W.push($q(Y))}W.sort(aW);for(let q=0;q<W.length;q++)$=rW(W[q],$);return $}function aW(J,Q){let $=J.x-Q.x;if($===0){if($=J.y-Q.y,$===0){let Z=(J.next.y-J.y)/(J.next.x-J.x),W=(Q.next.y-Q.y)/(Q.next.x-Q.x);$=Z-W}}return $}function rW(J,Q){let $=tW(J,Q);if(!$)return Q;let Z=i$($,J);return o7(Z,Z.next),o7($,$.next)}function tW(J,Q){let $=Q,Z=J.x,W=J.y,q=-1/0,K;if(C9(J,$))return $;do{if(C9(J,$.next))return $.next;else if(W<=$.y&&W>=$.next.y&&$.next.y!==$.y){let G=$.x+(W-$.y)*($.next.x-$.x)/($.next.y-$.y);if(G<=Z&&G>q){if(q=G,K=$.x<$.next.x?$:$.next,G===Z)return K}}$=$.next}while($!==Q);if(!K)return null;let H=K,U=K.x,Y=K.y,X=1/0;$=K;do{if(Z>=$.x&&$.x>=U&&Z!==$.x&&n$(W<Y?Z:q,W,U,Y,W<Y?q:Z,W,$.x,$.y)){let G=Math.abs(W-$.y)/(Z-$.x);if(Z0($,J)&&(G<X||G===X&&($.x>K.x||$.x===K.x&&eW(K,$))))K=$,X=G}$=$.next}while($!==H);return K}function eW(J,Q){return O6(J.prev,J,Q.prev)<0&&O6(Q.next,J,J.next)<0}function Jq(J,Q,$,Z){let W=J;do{if(W.z===0)W.z=N1(W.x,W.y,Q,$,Z);W.prevZ=W.prev,W.nextZ=W.next,W=W.next}while(W!==J);W.prevZ.nextZ=null,W.prevZ=null,Qq(W)}function Qq(J){let Q,$=1;do{let Z=J,W;J=null;let q=null;Q=0;while(Z){Q++;let K=Z,H=0;for(let Y=0;Y<$;Y++)if(H++,K=K.nextZ,!K)break;let U=$;while(H>0||U>0&&K){if(H!==0&&(U===0||!K||Z.z<=K.z))W=Z,Z=Z.nextZ,H--;else W=K,K=K.nextZ,U--;if(q)q.nextZ=W;else J=W;W.prevZ=q,q=W}Z=K}q.nextZ=null,$*=2}while(Q>1);return J}function N1(J,Q,$,Z,W){return J=(J-$)*W|0,Q=(Q-Z)*W|0,J=(J|J<<8)&16711935,J=(J|J<<4)&252645135,J=(J|J<<2)&858993459,J=(J|J<<1)&1431655765,Q=(Q|Q<<8)&16711935,Q=(Q|Q<<4)&252645135,Q=(Q|Q<<2)&858993459,Q=(Q|Q<<1)&1431655765,J|Q<<1}function $q(J){let Q=J,$=J;do{if(Q.x<$.x||Q.x===$.x&&Q.y<$.y)$=Q;Q=Q.next}while(Q!==J);return $}function n$(J,Q,$,Z,W,q,K,H){return(W-K)*(Q-H)>=(J-K)*(q-H)&&(J-K)*(Z-H)>=($-K)*(Q-H)&&($-K)*(q-H)>=(W-K)*(Z-H)}function a9(J,Q,$,Z,W,q,K,H){return!(J===K&&Q===H)&&n$(J,Q,$,Z,W,q,K,H)}function Zq(J,Q){return J.next.i!==Q.i&&J.prev.i!==Q.i&&!Wq(J,Q)&&(Z0(J,Q)&&Z0(Q,J)&&qq(J,Q)&&(O6(J.prev,J,Q.prev)||O6(J,Q.prev,Q))||C9(J,Q)&&O6(J.prev,J,J.next)>0&&O6(Q.prev,Q,Q.next)>0)}function O6(J,Q,$){return(Q.y-J.y)*($.x-Q.x)-(Q.x-J.x)*($.y-Q.y)}function C9(J,Q){return J.x===Q.x&&J.y===Q.y}function s$(J,Q,$,Z){let W=n0(O6(J,Q,$)),q=n0(O6(J,Q,Z)),K=n0(O6($,Z,J)),H=n0(O6($,Z,Q));if(W!==q&&K!==H)return!0;if(W===0&&c0(J,$,Q))return!0;if(q===0&&c0(J,Z,Q))return!0;if(K===0&&c0($,J,Z))return!0;if(H===0&&c0($,Q,Z))return!0;return!1}function c0(J,Q,$){return Q.x<=Math.max(J.x,$.x)&&Q.x>=Math.min(J.x,$.x)&&Q.y<=Math.max(J.y,$.y)&&Q.y>=Math.min(J.y,$.y)}function n0(J){return J>0?1:J<0?-1:0}function Wq(J,Q){let $=J;do{if($.i!==J.i&&$.next.i!==J.i&&$.i!==Q.i&&$.next.i!==Q.i&&s$($,$.next,J,Q))return!0;$=$.next}while($!==J);return!1}function Z0(J,Q){return O6(J.prev,J,J.next)<0?O6(J,Q,J.next)>=0&&O6(J,J.prev,Q)>=0:O6(J,Q,J.prev)<0||O6(J,J.next,Q)<0}function qq(J,Q){let $=J,Z=!1,W=(J.x+Q.x)/2,q=(J.y+Q.y)/2;do{if($.y>q!==$.next.y>q&&$.next.y!==$.y&&W<($.next.x-$.x)*(q-$.y)/($.next.y-$.y)+$.x)Z=!Z;$=$.next}while($!==J);return Z}function i$(J,Q){let $=E1(J.i,J.x,J.y),Z=E1(Q.i,Q.x,Q.y),W=J.next,q=Q.prev;return J.next=Q,Q.prev=J,$.next=W,W.prev=$,Z.next=$,$.prev=Z,q.next=Z,Z.prev=q,Z}function jQ(J,Q,$,Z){let W=E1(J,Q,$);if(!Z)W.prev=W,W.next=W;else W.next=Z.next,W.prev=Z,Z.next.prev=W,Z.next=W;return W}function W0(J){if(J.next.prev=J.prev,J.prev.next=J.next,J.prevZ)J.prevZ.nextZ=J.nextZ;if(J.nextZ)J.nextZ.prevZ=J.prevZ}function E1(J,Q,$){return{i:J,x:Q,y:$,prev:null,next:null,z:0,prevZ:null,nextZ:null,steiner:!1}}function Kq(J,Q,$,Z){let W=0;for(let q=Q,K=$-Z;q<$;q+=Z)W+=(J[K]-J[q])*(J[q+1]+J[K+1]),K=q;return W}class o${static triangulate(J,Q,$=2){return uW(J,Q,$)}}class H7{static area(J){let Q=J.length,$=0;for(let Z=Q-1,W=0;W<Q;Z=W++)$+=J[Z].x*J[W].y-J[W].x*J[Z].y;return $*0.5}static isClockWise(J){return H7.area(J)<0}static triangulateShape(J,Q){let $=[],Z=[],W=[];yQ(J),vQ($,J);let q=J.length;Q.forEach(yQ);for(let H=0;H<Q.length;H++)Z.push(q),q+=Q[H].length,vQ($,Q[H]);let K=o$.triangulate($,Z);for(let H=0;H<K.length;H+=3)W.push(K.slice(H,H+3));return W}}function yQ(J){let Q=J.length;if(Q>2&&J[Q-1].equals(J[0]))J.pop()}function vQ(J,Q){for(let $=0;$<Q.length;$++)J.push(Q[$].x),J.push(Q[$].y)}class $9 extends $7{constructor(J=new V5([new L8(0.5,0.5),new L8(-0.5,0.5),new L8(-0.5,-0.5),new L8(0.5,-0.5)]),Q={}){super();this.type="ExtrudeGeometry",this.parameters={shapes:J,options:Q},J=Array.isArray(J)?J:[J];let $=this,Z=[],W=[];for(let K=0,H=J.length;K<H;K++){let U=J[K];q(U)}this.setAttribute("position",new T6(Z,3)),this.setAttribute("uv",new T6(W,2)),this.computeVertexNormals();function q(K){let H=[],U=Q.curveSegments!==void 0?Q.curveSegments:12,Y=Q.steps!==void 0?Q.steps:1,X=Q.depth!==void 0?Q.depth:1,G=Q.bevelEnabled!==void 0?Q.bevelEnabled:!0,N=Q.bevelThickness!==void 0?Q.bevelThickness:0.2,F=Q.bevelSize!==void 0?Q.bevelSize:N-0.1,M=Q.bevelOffset!==void 0?Q.bevelOffset:0,L=Q.bevelSegments!==void 0?Q.bevelSegments:3,E=Q.extrudePath,O=Q.UVGenerator!==void 0?Q.UVGenerator:Hq,_,V=!1,B,w,y,D;if(E){_=E.getSpacedPoints(Y),V=!0,G=!1;let A=E.isCatmullRomCurve3?E.closed:!1;B=E.computeFrenetFrames(Y,A),w=new u,y=new u,D=new u}if(!G)L=0,N=0,F=0,M=0;let z=K.extractPoints(U),m=z.shape,t=z.holes;if(!H7.isClockWise(m)){m=m.reverse();for(let A=0,l=t.length;A<l;A++){let j=t[A];if(H7.isClockWise(j))t[A]=j.reverse()}}function J8(A){let o=A[0];for(let s=1;s<=A.length;s++){let q8=s%A.length,N8=A[q8],h=N8.x-o.x,x=N8.y-o.y,k8=h*h+x*x,f=Math.max(Math.abs(N8.x),Math.abs(N8.y),Math.abs(o.x),Math.abs(o.y)),Y8=0.000000000000000000010000000000000001*f*f;if(k8<=Y8){A.splice(q8,1),s--;continue}o=N8}}J8(m),t.forEach(J8);let E8=t.length,T=m;for(let A=0;A<E8;A++){let l=t[A];m=m.concat(l)}function H8(A,l,j){if(!l)e8("ExtrudeGeometry: vec does not exist");return A.clone().addScaledVector(l,j)}let e=m.length;function S(A,l,j){let o,s,q8,N8=A.x-l.x,h=A.y-l.y,x=j.x-A.x,k8=j.y-A.y,f=N8*N8+h*h,Y8=N8*k8-h*x;if(Math.abs(Y8)>Number.EPSILON){let Z8=Math.sqrt(f),A8=Math.sqrt(x*x+k8*k8),Q8=l.x-h/Z8,m8=l.y+N8/Z8,f8=j.x-k8/A8,j8=j.y+x/A8,l8=((f8-Q8)*k8-(j8-m8)*x)/(N8*k8-h*x);o=Q8+N8*l8-A.x,s=m8+h*l8-A.y;let I=o*o+s*s;if(I<=2)return new L8(o,s);else q8=Math.sqrt(I/2)}else{let Z8=!1;if(N8>Number.EPSILON){if(x>Number.EPSILON)Z8=!0}else if(N8<-Number.EPSILON){if(x<-Number.EPSILON)Z8=!0}else if(Math.sign(h)===Math.sign(k8))Z8=!0;if(Z8)o=-h,s=N8,q8=Math.sqrt(f);else o=N8,s=h,q8=Math.sqrt(f/2)}return new L8(o/q8,s/q8)}let B8=[];for(let A=0,l=T.length,j=l-1,o=A+1;A<l;A++,j++,o++){if(j===l)j=0;if(o===l)o=0;B8[A]=S(T[A],T[j],T[o])}let i=[],X8,V8=B8.concat();for(let A=0,l=E8;A<l;A++){let j=t[A];X8=[];for(let o=0,s=j.length,q8=s-1,N8=o+1;o<s;o++,q8++,N8++){if(q8===s)q8=0;if(N8===s)N8=0;X8[o]=S(j[o],j[q8],j[N8])}i.push(X8),V8=V8.concat(X8)}let v8;if(L===0)v8=H7.triangulateShape(T,t);else{let A=[],l=[];for(let j=0;j<L;j++){let o=j/L,s=N*Math.cos(o*Math.PI/2),q8=F*Math.sin(o*Math.PI/2)+M;for(let N8=0,h=T.length;N8<h;N8++){let x=H8(T[N8],B8[N8],q8);if(P(x.x,x.y,-s),o===0)A.push(x)}for(let N8=0,h=E8;N8<h;N8++){let x=t[N8];X8=i[N8];let k8=[];for(let f=0,Y8=x.length;f<Y8;f++){let Z8=H8(x[f],X8[f],q8);if(P(Z8.x,Z8.y,-s),o===0)k8.push(Z8)}if(o===0)l.push(k8)}}v8=H7.triangulateShape(A,l)}let U8=v8.length,M8=F+M;for(let A=0;A<e;A++){let l=G?H8(m[A],V8[A],M8):m[A];if(!V)P(l.x,l.y,0);else y.copy(B.normals[0]).multiplyScalar(l.x),w.copy(B.binormals[0]).multiplyScalar(l.y),D.copy(_[0]).add(y).add(w),P(D.x,D.y,D.z)}for(let A=1;A<=Y;A++)for(let l=0;l<e;l++){let j=G?H8(m[l],V8[l],M8):m[l];if(!V)P(j.x,j.y,X/Y*A);else y.copy(B.normals[A]).multiplyScalar(j.x),w.copy(B.binormals[A]).multiplyScalar(j.y),D.copy(_[A]).add(y).add(w),P(D.x,D.y,D.z)}for(let A=L-1;A>=0;A--){let l=A/L,j=N*Math.cos(l*Math.PI/2),o=F*Math.sin(l*Math.PI/2)+M;for(let s=0,q8=T.length;s<q8;s++){let N8=H8(T[s],B8[s],o);P(N8.x,N8.y,X+j)}for(let s=0,q8=t.length;s<q8;s++){let N8=t[s];X8=i[s];for(let h=0,x=N8.length;h<x;h++){let k8=H8(N8[h],X8[h],o);if(!V)P(k8.x,k8.y,X+j);else P(k8.x,k8.y+_[Y-1].y,_[Y-1].x+j)}}}b8(),n();function b8(){let A=Z.length/3;if(G){let l=0,j=e*l;for(let o=0;o<U8;o++){let s=v8[o];C(s[2]+j,s[1]+j,s[0]+j)}l=Y+L*2,j=e*l;for(let o=0;o<U8;o++){let s=v8[o];C(s[0]+j,s[1]+j,s[2]+j)}}else{for(let l=0;l<U8;l++){let j=v8[l];C(j[2],j[1],j[0])}for(let l=0;l<U8;l++){let j=v8[l];C(j[0]+e*Y,j[1]+e*Y,j[2]+e*Y)}}$.addGroup(A,Z.length/3-A,0)}function n(){let A=Z.length/3,l=0;d(T,l),l+=T.length;for(let j=0,o=t.length;j<o;j++){let s=t[j];d(s,l),l+=s.length}$.addGroup(A,Z.length/3-A,1)}function d(A,l){let j=A.length;while(--j>=0){let o=j,s=j-1;if(s<0)s=A.length-1;for(let q8=0,N8=Y+L*2;q8<N8;q8++){let h=e*q8,x=e*(q8+1),k8=l+o+h,f=l+s+h,Y8=l+s+x,Z8=l+o+x;g(k8,f,Y8,Z8)}}}function P(A,l,j){H.push(A),H.push(l),H.push(j)}function C(A,l,j){K8(A),K8(l),K8(j);let o=Z.length/3,s=O.generateTopUV($,Z,o-3,o-2,o-1);D8(s[0]),D8(s[1]),D8(s[2])}function g(A,l,j,o){K8(A),K8(l),K8(o),K8(l),K8(j),K8(o);let s=Z.length/3,q8=O.generateSideWallUV($,Z,s-6,s-3,s-2,s-1);D8(q8[0]),D8(q8[1]),D8(q8[3]),D8(q8[1]),D8(q8[2]),D8(q8[3])}function K8(A){Z.push(H[A*3+0]),Z.push(H[A*3+1]),Z.push(H[A*3+2])}function D8(A){W.push(A.x),W.push(A.y)}}}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}toJSON(){let J=super.toJSON(),Q=this.parameters.shapes,$=this.parameters.options;return Uq(Q,$,J)}static fromJSON(J,Q){let $=[];for(let W=0,q=J.shapes.length;W<q;W++){let K=Q[J.shapes[W]];$.push(K)}let Z=J.options.extrudePath;if(Z!==void 0)J.options.extrudePath=new G1[Z.type]().fromJSON(Z);return new $9($,J.options)}}var Hq={generateTopUV:function(J,Q,$,Z,W){let q=Q[$*3],K=Q[$*3+1],H=Q[Z*3],U=Q[Z*3+1],Y=Q[W*3],X=Q[W*3+1];return[new L8(q,K),new L8(H,U),new L8(Y,X)]},generateSideWallUV:function(J,Q,$,Z,W,q){let K=Q[$*3],H=Q[$*3+1],U=Q[$*3+2],Y=Q[Z*3],X=Q[Z*3+1],G=Q[Z*3+2],N=Q[W*3],F=Q[W*3+1],M=Q[W*3+2],L=Q[q*3],E=Q[q*3+1],O=Q[q*3+2];if(Math.abs(H-X)<Math.abs(K-Y))return[new L8(K,1-U),new L8(Y,1-G),new L8(N,1-M),new L8(L,1-O)];else return[new L8(H,1-U),new L8(X,1-G),new L8(F,1-M),new L8(E,1-O)]}};function Uq(J,Q,$){if($.shapes=[],Array.isArray(J))for(let Z=0,W=J.length;Z<W;Z++){let q=J[Z];$.shapes.push(q.uuid)}else $.shapes.push(J.uuid);if($.options=Object.assign({},Q),Q.extrudePath!==void 0)$.options.extrudePath=Q.extrudePath.toJSON();return $}class Z9 extends $7{constructor(J=1,Q=1,$=1,Z=1){super();this.type="PlaneGeometry",this.parameters={width:J,height:Q,widthSegments:$,heightSegments:Z};let W=J/2,q=Q/2,K=Math.floor($),H=Math.floor(Z),U=K+1,Y=H+1,X=J/K,G=Q/H,N=[],F=[],M=[],L=[];for(let E=0;E<Y;E++){let O=E*G-q;for(let _=0;_<U;_++){let V=_*X-W;F.push(V,-O,0),M.push(0,0,1),L.push(_/K),L.push(1-E/H)}}for(let E=0;E<H;E++)for(let O=0;O<K;O++){let _=O+U*E,V=O+U*(E+1),B=O+1+U*(E+1),w=O+1+U*E;N.push(_,V,w),N.push(V,B,w)}this.setIndex(N),this.setAttribute("position",new T6(F,3)),this.setAttribute("normal",new T6(M,3)),this.setAttribute("uv",new T6(L,2))}copy(J){return super.copy(J),this.parameters=Object.assign({},J.parameters),this}static fromJSON(J){return new Z9(J.width,J.height,J.widthSegments,J.heightSegments)}}function W9(J){let Q={};for(let $ in J){Q[$]={};for(let Z in J[$]){let W=J[$][Z];if(fQ(W))if(W.isRenderTargetTexture)t8("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),Q[$][Z]=null;else Q[$][Z]=W.clone();else if(Array.isArray(W))if(fQ(W[0])){let q=[];for(let K=0,H=W.length;K<H;K++)q[K]=W[K].clone();Q[$][Z]=q}else Q[$][Z]=W.slice();else Q[$][Z]=W}}return Q}function b6(J){let Q={};for(let $=0;$<J.length;$++){let Z=W9(J[$]);for(let W in Z)Q[W]=Z[W]}return Q}function fQ(J){return J&&(J.isColor||J.isMatrix3||J.isMatrix4||J.isVector2||J.isVector3||J.isVector4||J.isTexture||J.isQuaternion)}function Yq(J){let Q=[];for(let $=0;$<J.length;$++)Q.push(J[$].clone());return Q}function SJ(J){let Q=J.getRenderTarget();if(Q===null)return J.outputColorSpace;if(Q.isXRRenderTarget===!0)return Q.texture.colorSpace;return K6.workingColorSpace}var a$={clone:W9,merge:b6},Xq=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,Gq=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class Z7 extends h7{constructor(J){super();if(this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=Xq,this.fragmentShader=Gq,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,J!==void 0)this.setValues(J)}copy(J){return super.copy(J),this.fragmentShader=J.fragmentShader,this.vertexShader=J.vertexShader,this.uniforms=W9(J.uniforms),this.uniformsGroups=Yq(J.uniformsGroups),this.defines=Object.assign({},J.defines),this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.fog=J.fog,this.lights=J.lights,this.clipping=J.clipping,this.extensions=Object.assign({},J.extensions),this.glslVersion=J.glslVersion,this.defaultAttributeValues=Object.assign({},J.defaultAttributeValues),this.index0AttributeName=J.index0AttributeName,this.uniformsNeedUpdate=J.uniformsNeedUpdate,this}toJSON(J){let Q=super.toJSON(J);Q.glslVersion=this.glslVersion,Q.uniforms={};for(let Z in this.uniforms){let q=this.uniforms[Z].value;if(q&&q.isTexture)Q.uniforms[Z]={type:"t",value:q.toJSON(J).uuid};else if(q&&q.isColor)Q.uniforms[Z]={type:"c",value:q.getHex()};else if(q&&q.isVector2)Q.uniforms[Z]={type:"v2",value:q.toArray()};else if(q&&q.isVector3)Q.uniforms[Z]={type:"v3",value:q.toArray()};else if(q&&q.isVector4)Q.uniforms[Z]={type:"v4",value:q.toArray()};else if(q&&q.isMatrix3)Q.uniforms[Z]={type:"m3",value:q.toArray()};else if(q&&q.isMatrix4)Q.uniforms[Z]={type:"m4",value:q.toArray()};else Q.uniforms[Z]={value:q}}if(Object.keys(this.defines).length>0)Q.defines=this.defines;Q.vertexShader=this.vertexShader,Q.fragmentShader=this.fragmentShader,Q.lights=this.lights,Q.clipping=this.clipping;let $={};for(let Z in this.extensions)if(this.extensions[Z]===!0)$[Z]=!0;if(Object.keys($).length>0)Q.extensions=$;return Q}fromJSON(J,Q){if(super.fromJSON(J,Q),J.uniforms!==void 0)for(let $ in J.uniforms){let Z=J.uniforms[$];switch(this.uniforms[$]={},Z.type){case"t":this.uniforms[$].value=Q[Z.value]||null;break;case"c":this.uniforms[$].value=new r8().setHex(Z.value);break;case"v2":this.uniforms[$].value=new L8().fromArray(Z.value);break;case"v3":this.uniforms[$].value=new u().fromArray(Z.value);break;case"v4":this.uniforms[$].value=new R6().fromArray(Z.value);break;case"m3":this.uniforms[$].value=new i8().fromArray(Z.value);break;case"m4":this.uniforms[$].value=new G6().fromArray(Z.value);break;default:this.uniforms[$].value=Z.value}}if(J.defines!==void 0)this.defines=J.defines;if(J.vertexShader!==void 0)this.vertexShader=J.vertexShader;if(J.fragmentShader!==void 0)this.fragmentShader=J.fragmentShader;if(J.glslVersion!==void 0)this.glslVersion=J.glslVersion;if(J.extensions!==void 0)for(let $ in J.extensions)this.extensions[$]=J.extensions[$];if(J.lights!==void 0)this.lights=J.lights;if(J.clipping!==void 0)this.clipping=J.clipping;return this}}class jJ extends Z7{constructor(J){super(J);this.isRawShaderMaterial=!0,this.type="RawShaderMaterial"}}class x9 extends h7{constructor(J){super();this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new r8(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new r8(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new L8(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Y7,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.defines={STANDARD:""},this.color.copy(J.color),this.roughness=J.roughness,this.metalness=J.metalness,this.map=J.map,this.lightMap=J.lightMap,this.lightMapIntensity=J.lightMapIntensity,this.aoMap=J.aoMap,this.aoMapIntensity=J.aoMapIntensity,this.emissive.copy(J.emissive),this.emissiveMap=J.emissiveMap,this.emissiveIntensity=J.emissiveIntensity,this.bumpMap=J.bumpMap,this.bumpScale=J.bumpScale,this.normalMap=J.normalMap,this.normalMapType=J.normalMapType,this.normalScale.copy(J.normalScale),this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.roughnessMap=J.roughnessMap,this.metalnessMap=J.metalnessMap,this.alphaMap=J.alphaMap,this.envMap=J.envMap,this.envMapRotation.copy(J.envMapRotation),this.envMapIntensity=J.envMapIntensity,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.wireframeLinecap=J.wireframeLinecap,this.wireframeLinejoin=J.wireframeLinejoin,this.flatShading=J.flatShading,this.fog=J.fog,this}}class I5 extends x9{constructor(J){super();this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new L8(1,1),this.clearcoatNormalMap=null,this.diffuseRoughnessMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Z6(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(Q){this.ior=(1+0.4*Q)/(1-0.4*Q)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessMinimum=100,this.iridescenceThicknessMaximum=400,this.iridescenceThicknessMap=null,this.sheenColor=new r8(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new r8(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new r8(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._diffuseRoughness=0,this._dispersion=0,this._iridescence=0,this._retroreflectivity=0,this._sheen=0,this._transmission=0,this.setValues(J)}get anisotropy(){return this._anisotropy}set anisotropy(J){if(this._anisotropy>0!==J>0)this.version++;this._anisotropy=J}get clearcoat(){return this._clearcoat}set clearcoat(J){if(this._clearcoat>0!==J>0)this.version++;this._clearcoat=J}get diffuseRoughness(){return this._diffuseRoughness}set diffuseRoughness(J){if(this._diffuseRoughness>0!==J>0)this.version++;this._diffuseRoughness=J}get iridescence(){return this._iridescence}set iridescence(J){if(this._iridescence>0!==J>0)this.version++;this._iridescence=J}get dispersion(){return this._dispersion}set dispersion(J){if(this._dispersion>0!==J>0)this.version++;this._dispersion=J}get retroreflectivity(){return this._retroreflectivity}set retroreflectivity(J){if(this._retroreflectivity>0!==J>0)this.version++;this._retroreflectivity=J}get sheen(){return this._sheen}set sheen(J){if(this._sheen>0!==J>0)this.version++;this._sheen=J}get transmission(){return this._transmission}set transmission(J){if(this._transmission>0!==J>0)this.version++;this._transmission=J}get iridescenceThicknessRange(){return s7('MeshPhysicalMaterial: The "iridescenceThicknessRange" property has been replaced by "iridescenceThicknessMinimum" and "iridescenceThicknessMaximum".'),[this.iridescenceThicknessMinimum,this.iridescenceThicknessMaximum]}set iridescenceThicknessRange(J){s7('MeshPhysicalMaterial: The "iridescenceThicknessRange" property has been replaced by "iridescenceThicknessMinimum" and "iridescenceThicknessMaximum".'),this.iridescenceThicknessMinimum=J[0],this.iridescenceThicknessMaximum=J[1]}copy(J){return super.copy(J),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=J.anisotropy,this.anisotropyRotation=J.anisotropyRotation,this.anisotropyMap=J.anisotropyMap,this.clearcoat=J.clearcoat,this.clearcoatMap=J.clearcoatMap,this.clearcoatRoughness=J.clearcoatRoughness,this.clearcoatRoughnessMap=J.clearcoatRoughnessMap,this.clearcoatNormalMap=J.clearcoatNormalMap,this.clearcoatNormalScale.copy(J.clearcoatNormalScale),this.diffuseRoughness=J.diffuseRoughness,this.diffuseRoughnessMap=J.diffuseRoughnessMap,this.dispersion=J.dispersion,this.ior=J.ior,this.iridescence=J.iridescence,this.iridescenceMap=J.iridescenceMap,this.iridescenceIOR=J.iridescenceIOR,this.iridescenceThicknessMinimum=J.iridescenceThicknessMinimum,this.iridescenceThicknessMaximum=J.iridescenceThicknessMaximum,this.iridescenceThicknessMap=J.iridescenceThicknessMap,this.retroreflectivity=J.retroreflectivity,this.sheen=J.sheen,this.sheenColor.copy(J.sheenColor),this.sheenColorMap=J.sheenColorMap,this.sheenRoughness=J.sheenRoughness,this.sheenRoughnessMap=J.sheenRoughnessMap,this.transmission=J.transmission,this.transmissionMap=J.transmissionMap,this.thickness=J.thickness,this.thicknessMap=J.thicknessMap,this.attenuationDistance=J.attenuationDistance,this.attenuationColor.copy(J.attenuationColor),this.specularIntensity=J.specularIntensity,this.specularIntensityMap=J.specularIntensityMap,this.specularColor.copy(J.specularColor),this.specularColorMap=J.specularColorMap,this}}class A5 extends h7{constructor(J){super();this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new r8(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new r8(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=0,this.normalScale=new L8(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new Y7,this.combine=0,this.reflectivity=1,this.envMapIntensity=1,this.refractionRatio=0.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(J)}copy(J){return super.copy(J),this.color.copy(J.color),this.map=J.map,this.lightMap=J.lightMap,this.lightMapIntensity=J.lightMapIntensity,this.aoMap=J.aoMap,this.aoMapIntensity=J.aoMapIntensity,this.emissive.copy(J.emissive),this.emissiveMap=J.emissiveMap,this.emissiveIntensity=J.emissiveIntensity,this.bumpMap=J.bumpMap,this.bumpScale=J.bumpScale,this.normalMap=J.normalMap,this.normalMapType=J.normalMapType,this.normalScale.copy(J.normalScale),this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.specularMap=J.specularMap,this.alphaMap=J.alphaMap,this.envMap=J.envMap,this.envMapRotation.copy(J.envMapRotation),this.combine=J.combine,this.reflectivity=J.reflectivity,this.envMapIntensity=J.envMapIntensity,this.refractionRatio=J.refractionRatio,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this.wireframeLinecap=J.wireframeLinecap,this.wireframeLinejoin=J.wireframeLinejoin,this.flatShading=J.flatShading,this.fog=J.fog,this}}class yJ extends h7{constructor(J){super();this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=3200,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(J)}copy(J){return super.copy(J),this.depthPacking=J.depthPacking,this.map=J.map,this.alphaMap=J.alphaMap,this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this.wireframe=J.wireframe,this.wireframeLinewidth=J.wireframeLinewidth,this}}class vJ extends h7{constructor(J){super();this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(J)}copy(J){return super.copy(J),this.map=J.map,this.alphaMap=J.alphaMap,this.displacementMap=J.displacementMap,this.displacementScale=J.displacementScale,this.displacementBias=J.displacementBias,this}}function B9(J,Q){if(!J||J.constructor===Q)return J;if(typeof Q.BYTES_PER_ELEMENT==="number")return new Q(J);return Array.prototype.slice.call(J)}function s0(J){return J!==void 0&&J.inTangents!==void 0&&J.outTangents!==void 0}class q9{constructor(J,Q,$,Z){this.parameterPositions=J,this._cachedIndex=0,this.resultBuffer=Z!==void 0?Z:new Q.constructor($),this.sampleValues=Q,this.valueSize=$,this.settings=null,this.DefaultSettings_={}}evaluate(J){let Q=this.parameterPositions,$=this._cachedIndex,Z=Q[$],W=Q[$-1];$:{J:{let q;Q:{Z:if(!(J<Z)){for(let K=$+2;;){if(Z===void 0){if(J<W)break Z;return $=Q.length,this._cachedIndex=$,this.copySampleValue_($-1)}if($===K)break;if(W=Z,Z=Q[++$],J<Z)break J}q=Q.length;break Q}if(!(J>=W)){let K=Q[1];if(J<K)$=2,W=K;for(let H=$-2;;){if(W===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if($===H)break;if(Z=W,W=Q[--$-1],J>=W)break J}q=$,$=0;break Q}break $}while($<q){let K=$+q>>>1;if(J<Q[K])q=K;else $=K+1}if(Z=Q[$],W=Q[$-1],W===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(Z===void 0)return $=Q.length,this._cachedIndex=$,this.copySampleValue_($-1)}this._cachedIndex=$,this.intervalChanged_($,W,Z)}return this.interpolate_($,W,J,Z)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(J){let Q=this.resultBuffer,$=this.sampleValues,Z=this.valueSize,W=J*Z;for(let q=0;q!==Z;++q)Q[q]=$[W+q];return Q}interpolate_(){throw Error("THREE.Interpolant: Call to abstract method.")}intervalChanged_(){}}class fJ extends q9{constructor(J,Q,$,Z){super(J,Q,$,Z);this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:2400,endingEnd:2400}}intervalChanged_(J,Q,$){let Z=this.parameterPositions,W=J-2,q=J+1,K=Z[W],H=Z[q];if(K===void 0)switch(this.getSettings_().endingStart){case 2401:W=J,K=2*Q-$;break;case 2402:W=Z.length-2,K=Q+Z[W]-Z[W+1];break;default:W=J,K=$}if(H===void 0)switch(this.getSettings_().endingEnd){case 2401:q=J,H=2*$-Q;break;case 2402:q=1,H=$+Z[1]-Z[0];break;default:q=J-1,H=Q}let U=($-Q)*0.5,Y=this.valueSize;this._weightPrev=U/(Q-K),this._weightNext=U/(H-$),this._offsetPrev=W*Y,this._offsetNext=q*Y}interpolate_(J,Q,$,Z){let W=this.resultBuffer,q=this.sampleValues,K=this.valueSize,H=J*K,U=H-K,Y=this._offsetPrev,X=this._offsetNext,G=this._weightPrev,N=this._weightNext,F=($-Q)/(Z-Q),M=F*F,L=M*F,E=-G*L+2*G*M-G*F,O=(1+G)*L+(-1.5-2*G)*M+(-0.5+G)*F+1,_=(-1-N)*L+(1.5+N)*M+0.5*F,V=N*L-N*M;for(let B=0;B!==K;++B)W[B]=E*q[Y+B]+O*q[U+B]+_*q[H+B]+V*q[X+B];return W}}class bJ extends q9{constructor(J,Q,$,Z){super(J,Q,$,Z)}interpolate_(J,Q,$,Z){let W=this.resultBuffer,q=this.sampleValues,K=this.valueSize,H=J*K,U=H-K,Y=($-Q)/(Z-Q),X=1-Y;for(let G=0;G!==K;++G)W[G]=q[U+G]*X+q[H+G]*Y;return W}}class hJ extends q9{constructor(J,Q,$,Z){super(J,Q,$,Z)}interpolate_(J){return this.copySampleValue_(J-1)}}class xJ extends q9{interpolate_(J,Q,$,Z){let W=this.resultBuffer,q=this.sampleValues,K=this.valueSize,H=J*K,U=H-K,Y=this.inTangents,X=this.outTangents;if(!Y||!X){let F=($-Q)/(Z-Q),M=1-F;for(let L=0;L!==K;++L)W[L]=q[U+L]*M+q[H+L]*F;return W}let G=K*2,N=J-1;for(let F=0;F!==K;++F){let M=q[U+F],L=q[H+F],E=N*G+F*2,O=X[E],_=X[E+1],V=J*G+F*2,B=Y[V],w=Y[V+1],y=Eq($,Q,O,B,Z);W[F]=r$(y,M,_,w,L)}return W}}function r$(J,Q,$,Z,W){let q=1-J;return q*q*q*Q+3*q*q*J*$+3*q*J*J*Z+J*J*J*W}function Nq(J,Q,$,Z,W){let q=1-J;return 3*q*q*($-Q)+6*q*J*(Z-$)+3*J*J*(W-Z)}function Eq(J,Q,$,Z,W){let q=(J-Q)/(W-Q);for(let K=0;K<8;K++){let H=r$(q,Q,$,Z,W)-J;if(Math.abs(H)<0.0000000001)break;let U=Nq(q,Q,$,Z,W);if(Math.abs(U)<0.0000000001)break;q=Math.max(0,Math.min(1,q-H/U))}return q}class s6{constructor(J,Q,$,Z){if(J===void 0)throw Error("THREE.KeyframeTrack: track name is undefined");if(Q===void 0||Q.length===0)throw Error("THREE.KeyframeTrack: no keyframes in track named "+J);this.name=J,this.times=B9(Q,this.TimeBufferType),this.values=B9($,this.ValueBufferType),this.setInterpolation(Z||this.DefaultInterpolation)}static toJSON(J){let Q=J.constructor,$;if(Q.toJSON!==this.toJSON)$=Q.toJSON(J);else{$={name:J.name,times:B9(J.times,Array),values:B9(J.values,Array)};let Z=J.getInterpolation();if(Z!==J.DefaultInterpolation)$.interpolation=Z;if(s0(J.settings))$.settings={inTangents:B9(J.settings.inTangents,Array),outTangents:B9(J.settings.outTangents,Array)}}return $.type=J.ValueTypeName,$}InterpolantFactoryMethodDiscrete(J){return new hJ(this.times,this.values,this.getValueSize(),J)}InterpolantFactoryMethodLinear(J){return new bJ(this.times,this.values,this.getValueSize(),J)}InterpolantFactoryMethodSmooth(J){return new fJ(this.times,this.values,this.getValueSize(),J)}InterpolantFactoryMethodBezier(J){let Q=new xJ(this.times,this.values,this.getValueSize(),J);if(this.settings)Q.inTangents=this.settings.inTangents,Q.outTangents=this.settings.outTangents;return Q}setInterpolation(J){let Q;switch(J){case 2300:Q=this.InterpolantFactoryMethodDiscrete;break;case 2301:Q=this.InterpolantFactoryMethodLinear;break;case 2302:Q=this.InterpolantFactoryMethodSmooth;break;case 2303:Q=this.InterpolantFactoryMethodBezier;break}if(Q===void 0){let $="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(J!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw Error($);return t8("KeyframeTrack:",$),this}return this.createInterpolant=Q,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return 2300;case this.InterpolantFactoryMethodLinear:return 2301;case this.InterpolantFactoryMethodSmooth:return 2302;case this.InterpolantFactoryMethodBezier:return 2303}}getValueSize(){return this.values.length/this.times.length}shift(J){if(J!==0){let Q=this.times;for(let $=0,Z=Q.length;$!==Z;++$)Q[$]+=J;if(s0(this.settings))bQ(this.settings.inTangents,J),bQ(this.settings.outTangents,J)}return this}scale(J){if(J!==1){let Q=this.times;for(let $=0,Z=Q.length;$!==Z;++$)Q[$]*=J;if(s0(this.settings))hQ(this.settings.inTangents,J),hQ(this.settings.outTangents,J)}return this}trim(J,Q){let $=this.times,Z=$.length,W=0,q=Z-1;while(W!==Z&&$[W]<J)++W;while(q!==-1&&$[q]>Q)--q;if(++q,W!==0||q!==Z){if(W>=q)q=Math.max(q,1),W=q-1;let K=this.getValueSize();this.times=$.slice(W,q),this.values=this.values.slice(W*K,q*K)}return this}validate(){let J=!0,Q=this.getValueSize();if(Q-Math.floor(Q)!==0)e8("KeyframeTrack: Invalid value size in track.",this),J=!1;let $=this.times,Z=this.values,W=$.length;if(W===0)e8("KeyframeTrack: Track is empty.",this),J=!1;let q=null;for(let K=0;K!==W;K++){let H=$[K];if(typeof H==="number"&&isNaN(H)){e8("KeyframeTrack: Time is not a valid number.",this,K,H),J=!1;break}if(q!==null&&q>H){e8("KeyframeTrack: Out of order keys.",this,K,H,q),J=!1;break}q=H}if(Z!==void 0){if($W(Z))for(let K=0,H=Z.length;K!==H;++K){let U=Z[K];if(isNaN(U)){e8("KeyframeTrack: Value is not a valid number.",this,K,U),J=!1;break}}}return J}optimize(){let J=this.times.slice(),Q=this.values.slice(),$=this.getValueSize(),Z=this.getInterpolation()===2302,W=J.length-1,q=1;for(let K=1;K<W;++K){let H=!1,U=J[K],Y=J[K+1];if(U!==Y&&(K!==1||U!==J[0]))if(!Z){let X=K*$,G=X-$,N=X+$;for(let F=0;F!==$;++F){let M=Q[X+F];if(M!==Q[G+F]||M!==Q[N+F]){H=!0;break}}}else H=!0;if(H){if(K!==q){J[q]=J[K];let X=K*$,G=q*$;for(let N=0;N!==$;++N)Q[G+N]=Q[X+N]}++q}}if(W>0){J[q]=J[W];for(let K=W*$,H=q*$,U=0;U!==$;++U)Q[H+U]=Q[K+U];++q}if(q!==J.length)this.times=J.slice(0,q),this.values=Q.slice(0,q*$);else this.times=J,this.values=Q;return this}clone(){let J=this.times.slice(),Q=this.values.slice(),Z=new this.constructor(this.name,J,Q);if(Z.createInterpolant=this.createInterpolant,s0(this.settings))Z.settings={inTangents:this.settings.inTangents.slice(),outTangents:this.settings.outTangents.slice()};return Z}}function bQ(J,Q){for(let $=0,Z=J.length;$!==Z;$+=2)J[$]+=Q}function hQ(J,Q){for(let $=0,Z=J.length;$!==Z;$+=2)J[$]*=Q}s6.prototype.ValueTypeName="";s6.prototype.TimeBufferType=Float32Array;s6.prototype.ValueBufferType=Float32Array;s6.prototype.DefaultInterpolation=2301;class K9 extends s6{constructor(J,Q,$){super(J,Q,$)}}K9.prototype.ValueTypeName="bool";K9.prototype.ValueBufferType=Array;K9.prototype.DefaultInterpolation=2300;K9.prototype.InterpolantFactoryMethodLinear=void 0;K9.prototype.InterpolantFactoryMethodSmooth=void 0;class gJ extends s6{constructor(J,Q,$,Z){super(J,Q,$,Z)}}gJ.prototype.ValueTypeName="color";class pJ extends s6{constructor(J,Q,$,Z){super(J,Q,$,Z)}}pJ.prototype.ValueTypeName="number";class mJ extends q9{constructor(J,Q,$,Z){super(J,Q,$,Z)}interpolate_(J,Q,$,Z){let W=this.resultBuffer,q=this.sampleValues,K=this.valueSize,H=($-Q)/(Z-Q),U=J*K;for(let Y=U+K;U!==Y;U+=4)_7.slerpFlat(W,0,q,U-K,q,U,H);return W}}class _5 extends s6{constructor(J,Q,$,Z){super(J,Q,$,Z)}InterpolantFactoryMethodLinear(J){return new mJ(this.times,this.values,this.getValueSize(),J)}}_5.prototype.ValueTypeName="quaternion";_5.prototype.InterpolantFactoryMethodSmooth=void 0;class H9 extends s6{constructor(J,Q,$){super(J,Q,$)}}H9.prototype.ValueTypeName="string";H9.prototype.ValueBufferType=Array;H9.prototype.DefaultInterpolation=2300;H9.prototype.InterpolantFactoryMethodLinear=void 0;H9.prototype.InterpolantFactoryMethodSmooth=void 0;class lJ extends s6{constructor(J,Q,$,Z){super(J,Q,$,Z)}}lJ.prototype.ValueTypeName="vector";var F1={enabled:!1,files:{},add:function(J,Q){if(this.enabled===!1)return;if(xQ(J))return;this.files[J]=Q},get:function(J){if(this.enabled===!1)return;if(xQ(J))return;return this.files[J]},remove:function(J){delete this.files[J]},clear:function(){this.files={}}};function xQ(J){try{let Q=J.slice(J.indexOf(":")+1);return new URL(Q).protocol==="blob:"}catch(Q){return!1}}class dJ{constructor(J,Q,$){let Z=this,W=!1,q=0,K=0,H=void 0,U=[];this.onStart=void 0,this.onLoad=J,this.onProgress=Q,this.onError=$,this._abortController=null,this.itemStart=function(Y){if(K++,W===!1){if(Z.onStart!==void 0)Z.onStart(Y,q,K)}W=!0},this.itemEnd=function(Y){if(q++,Z.onProgress!==void 0)Z.onProgress(Y,q,K);if(q===K){if(W=!1,Z.onLoad!==void 0)Z.onLoad()}},this.itemError=function(Y){if(Z.onError!==void 0)Z.onError(Y)},this.resolveURL=function(Y){if(Y=Y.normalize("NFC"),H)return H(Y);return Y},this.setURLModifier=function(Y){return H=Y,this},this.addHandler=function(Y,X){return U.push(Y,X),this},this.removeHandler=function(Y){let X=U.indexOf(Y);if(X!==-1)U.splice(X,2);return this},this.getHandler=function(Y){for(let X=0,G=U.length;X<G;X+=2){let N=U[X],F=U[X+1];if(N.global)N.lastIndex=0;if(N.test(Y))return F}return null},this.abort=function(){return this.abortController.abort(),this._abortController=null,this}}get abortController(){if(!this._abortController)this._abortController=new AbortController;return this._abortController}}var t$=new dJ;class U9{constructor(J){if(this.manager=J!==void 0?J:t$,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={},this.priority="auto",this.cache="default",typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}load(){}loadAsync(J,Q){let $=this;return new Promise(function(Z,W){$.load(J,Z,Q,W)})}parse(){}setCrossOrigin(J){return this.crossOrigin=J,this}setWithCredentials(J){return this.withCredentials=J,this}setPath(J){return this.path=J,this}setResourcePath(J){return this.resourcePath=J,this}setRequestHeader(J){return this.requestHeader=J,this}setPriority(J){return this.priority=J,this}setCache(J){return this.cache=J,this}abort(){return this}}U9.DEFAULT_MATERIAL_NAME="__DEFAULT";var B7={};class e$ extends Error{constructor(J,Q){super(J);this.response=Q}}class F0 extends U9{constructor(J){super(J);this.mimeType="",this.responseType="",this._abortController=new AbortController}load(J,Q,$,Z){if(J===void 0)J="";if(this.path!==void 0)J=this.path+J;J=this.manager.resolveURL(J);let W=F1.get(`file:${J}`);if(W!==void 0){this.manager.itemStart(J),setTimeout(()=>{if(Q)Q(W);this.manager.itemEnd(J)},0);return}if(B7[J]!==void 0){B7[J].push({onLoad:Q,onProgress:$,onError:Z});return}B7[J]=[],B7[J].push({onLoad:Q,onProgress:$,onError:Z});let q=new Request(J,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",priority:this.priority,cache:this.cache,signal:typeof AbortSignal.any==="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),K=this.mimeType,H=this.responseType;fetch(q).then((U)=>{if(U.status===200||U.status===0){if(U.status===0)t8("FileLoader: HTTP Status 0 received.");if(typeof ReadableStream>"u"||U.body===void 0||U.body.getReader===void 0)return U;let Y=B7[J],X=U.body.getReader(),G=U.headers.get("X-File-Size")||U.headers.get("Content-Length"),N=G?parseInt(G):0,F=N!==0,M=0,L=new ReadableStream({start(E){O();function O(){X.read().then(({done:_,value:V})=>{if(_)E.close();else{M+=V.byteLength;let B=new ProgressEvent("progress",{lengthComputable:F,loaded:M,total:N});for(let w=0,y=Y.length;w<y;w++){let D=Y[w];if(D.onProgress)D.onProgress(B)}E.enqueue(V),O()}},(_)=>{E.error(_)})}}});return new Response(L)}else throw new e$(`fetch for "${U.url}" responded with ${U.status}: ${U.statusText}`,U)}).then((U)=>{switch(H){case"arraybuffer":return U.arrayBuffer();case"blob":return U.blob();case"document":return U.text().then((Y)=>{return new DOMParser().parseFromString(Y,K)});case"json":return U.json();default:if(K==="")return U.text();else{let X=/charset="?([^;"\s]*)"?/i.exec(K),G=X&&X[1]?X[1].toLowerCase():void 0,N=new TextDecoder(G);return U.arrayBuffer().then((F)=>N.decode(F))}}}).then((U)=>{F1.add(`file:${J}`,U);let Y=B7[J];delete B7[J];for(let X=0,G=Y.length;X<G;X++){let N=Y[X];if(N.onLoad)N.onLoad(U)}}).catch((U)=>{let Y=B7[J];if(Y===void 0)throw this.manager.itemError(J),U;delete B7[J];for(let X=0,G=Y.length;X<G;X++){let N=Y[X];if(N.onError)N.onError(U)}this.manager.itemError(J)}).finally(()=>{this.manager.itemEnd(J)}),this.manager.itemStart(J)}setResponseType(J){return this.responseType=J,this}setMimeType(J){return this.mimeType=J,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}}class C5 extends z6{static registerNode(J){this.prototype._lightNode=J}constructor(J,Q=1){super();this.isLight=!0,this.type="Light",this.color=new r8(J),this.intensity=Q}copy(J,Q){return super.copy(J,Q),this.color.copy(J.color),this.intensity=J.intensity,this}toJSON(J){let Q=super.toJSON(J);return Q.object.color=this.color.getHex(),Q.object.intensity=this.intensity,Q}}var X1=new G6,gQ=new u,pQ=new u;class P5{constructor(J){this.camera=J,this.intensity=1,this.bias=0,this.biasNode=null,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new L8(512,512),this.mapType=1009,this.map=null,this.mapPass=null,this.matrix=new G6,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new i7,this._frameExtents=new L8(1,1),this._viewportCount=1,this._viewports=[new R6(0,0,1,1)]}getViewportCount(){return this._viewportCount}getCamera(){return this.camera}getFrustum(){return this._frustum}updateMatrices(J){let Q=this.camera;gQ.setFromMatrixPosition(J.matrixWorld),Q.position.copy(gQ),pQ.setFromMatrixPosition(J.target.matrixWorld),Q.lookAt(pQ),Q.updateMatrixWorld(),this._updateMatrix(Q,this.matrix,this._frustum)}_updateMatrix(J,Q,$,Z){X1.multiplyMatrices(J.projectionMatrix,J.matrixWorldInverse),$.setFromProjectionMatrix(X1,J.coordinateSystem,J.reversedDepth);let W=this._frameExtents,q=Z?Z.z/W.x:1,K=Z?Z.w/W.y:1,H=Z?Z.x/W.x:0,U=Z?Z.y/W.y:0;if(J.coordinateSystem===2001||J.reversedDepth)Q.set(0.5*q,0,0,0.5*q+H,0,0.5*K,0,0.5*K+U,0,0,1,0,0,0,0,1);else Q.set(0.5*q,0,0,0.5*q+H,0,0.5*K,0,0.5*K+U,0,0,0.5,0.5,0,0,0,1);Q.multiply(X1)}getViewport(J){return this._viewports[J]}getFrameExtents(){return this._frameExtents}dispose(){if(this.map)this.map.dispose();if(this.mapPass)this.mapPass.dispose()}copy(J){return this.camera=J.camera.clone(),this.intensity=J.intensity,this.bias=J.bias,this.radius=J.radius,this.autoUpdate=J.autoUpdate,this.needsUpdate=J.needsUpdate,this.normalBias=J.normalBias,this.blurSamples=J.blurSamples,this.mapSize.copy(J.mapSize),this.mapType=J.mapType,this.biasNode=J.biasNode,this}clone(){return new this.constructor().copy(this)}toJSON(){let J={};return J.intensity=this.intensity,J.bias=this.bias,J.normalBias=this.normalBias,J.radius=this.radius,J.blurSamples=this.blurSamples,J.mapSize=this.mapSize.toArray(),J.mapType=this.mapType,J.camera=this.camera.toJSON(!1).object,delete J.camera.matrix,J}}var i0=new u,o0=new _7,W7=new u;class w5 extends z6{constructor(){super();this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new G6,this.projectionMatrix=new G6,this.projectionMatrixInverse=new G6,this.coordinateSystem=2000,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(J,Q){return super.copy(J,Q),this.matrixWorldInverse.copy(J.matrixWorldInverse),this.projectionMatrix.copy(J.projectionMatrix),this.projectionMatrixInverse.copy(J.projectionMatrixInverse),this.coordinateSystem=J.coordinateSystem,this}getWorldDirection(J){return super.getWorldDirection(J).negate()}updateMatrixWorld(J){if(super.updateMatrixWorld(J),this.matrixWorld.decompose(i0,o0,W7),W7.x===1&&W7.y===1&&W7.z===1)this.matrixWorldInverse.copy(this.matrixWorld).invert();else this.matrixWorldInverse.compose(i0,o0,W7.set(1,1,1)).invert()}updateWorldMatrix(J,Q,$=!1){if(super.updateWorldMatrix(J,Q,$),this.matrixWorld.decompose(i0,o0,W7),W7.x===1&&W7.y===1&&W7.z===1)this.matrixWorldInverse.copy(this.matrixWorld).invert();else this.matrixWorldInverse.compose(i0,o0,W7.set(1,1,1)).invert()}clone(){return new this.constructor().copy(this)}}var y7=new u,mQ=new L8,lQ=new L8;class x6 extends w5{constructor(J=50,Q=1,$=0.1,Z=2000){super();this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=J,this.zoom=1,this.near=$,this.far=Z,this.focus=10,this.aspect=Q,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(J,Q){return super.copy(J,Q),this.fov=J.fov,this.zoom=J.zoom,this.near=J.near,this.far=J.far,this.focus=J.focus,this.aspect=J.aspect,this.view=J.view===null?null:Object.assign({},J.view),this.filmGauge=J.filmGauge,this.filmOffset=J.filmOffset,this}setFocalLength(J){let Q=0.5*this.getFilmHeight()/J;this.fov=_9*2*Math.atan(Q),this.updateProjectionMatrix()}getFocalLength(){let J=Math.tan(r9*0.5*this.fov);return 0.5*this.getFilmHeight()/J}getEffectiveFOV(){return _9*2*Math.atan(Math.tan(r9*0.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(J,Q,$){y7.set(-1,-1,0.5).applyMatrix4(this.projectionMatrixInverse),Q.set(y7.x,y7.y).multiplyScalar(-J/y7.z),y7.set(1,1,0.5).applyMatrix4(this.projectionMatrixInverse),$.set(y7.x,y7.y).multiplyScalar(-J/y7.z)}getViewSize(J,Q){return this.getViewBounds(J,mQ,lQ),Q.subVectors(lQ,mQ)}setViewOffset(J,Q,$,Z,W,q){if(this.aspect=J/Q,this.view===null)this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1};this.view.enabled=!0,this.view.fullWidth=J,this.view.fullHeight=Q,this.view.offsetX=$,this.view.offsetY=Z,this.view.width=W,this.view.height=q,this.updateProjectionMatrix()}clearViewOffset(){if(this.view!==null)this.view.enabled=!1;this.updateProjectionMatrix()}updateProjectionMatrix(){let J=this.near,Q=J*Math.tan(r9*0.5*this.fov)/this.zoom,$=2*Q,Z=this.aspect*$,W=-0.5*Z,q=this.view;if(this.view!==null&&this.view.enabled){let{fullWidth:H,fullHeight:U}=q;W+=q.offsetX*Z/H,Q-=q.offsetY*$/U,Z*=q.width/H,$*=q.height/U}let K=this.filmOffset;if(K!==0)W+=J*K/this.getFilmWidth();this.projectionMatrix.makePerspective(W,W+Z,Q,Q-$,J,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(J){let Q=super.toJSON(J);if(Q.object.fov=this.fov,Q.object.zoom=this.zoom,Q.object.near=this.near,Q.object.far=this.far,Q.object.focus=this.focus,Q.object.aspect=this.aspect,this.view!==null)Q.object.view=Object.assign({},this.view);return Q.object.filmGauge=this.filmGauge,Q.object.filmOffset=this.filmOffset,Q}}class JZ extends P5{constructor(){super(new x6(90,1,0.5,500));this.isPointLightShadow=!0}}class g9 extends C5{constructor(J,Q,$=0,Z=2){super(J,Q);this.isPointLight=!0,this.type="PointLight",this.distance=$,this.decay=Z,this.shadow=new JZ}get power(){return this.intensity*4*Math.PI}set power(J){this.intensity=J/(4*Math.PI)}dispose(){super.dispose(),this.shadow.dispose()}copy(J,Q){return super.copy(J,Q),this.distance=J.distance,this.decay=J.decay,this.shadow=J.shadow.clone(),this}toJSON(J){let Q=super.toJSON(J);return Q.object.distance=this.distance,Q.object.decay=this.decay,Q.object.shadow=this.shadow.toJSON(),Q}}class T5 extends w5{constructor(J=-1,Q=1,$=1,Z=-1,W=0.1,q=2000){super();this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=J,this.right=Q,this.top=$,this.bottom=Z,this.near=W,this.far=q,this.updateProjectionMatrix()}copy(J,Q){return super.copy(J,Q),this.left=J.left,this.right=J.right,this.top=J.top,this.bottom=J.bottom,this.near=J.near,this.far=J.far,this.zoom=J.zoom,this.view=J.view===null?null:Object.assign({},J.view),this}setViewOffset(J,Q,$,Z,W,q){if(this.view===null)this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1};this.view.enabled=!0,this.view.fullWidth=J,this.view.fullHeight=Q,this.view.offsetX=$,this.view.offsetY=Z,this.view.width=W,this.view.height=q,this.updateProjectionMatrix()}clearViewOffset(){if(this.view!==null)this.view.enabled=!1;this.updateProjectionMatrix()}updateProjectionMatrix(){let J=(this.right-this.left)/(2*this.zoom),Q=(this.top-this.bottom)/(2*this.zoom),$=(this.right+this.left)/2,Z=(this.top+this.bottom)/2,W=$-J,q=$+J,K=Z+Q,H=Z-Q;if(this.view!==null&&this.view.enabled){let U=(this.right-this.left)/this.view.fullWidth/this.zoom,Y=(this.top-this.bottom)/this.view.fullHeight/this.zoom;W+=U*this.view.offsetX,q=W+U*this.view.width,K-=Y*this.view.offsetY,H=K-Y*this.view.height}this.projectionMatrix.makeOrthographic(W,q,K,H,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(J){let Q=super.toJSON(J);if(Q.object.zoom=this.zoom,Q.object.left=this.left,Q.object.right=this.right,Q.object.top=this.top,Q.object.bottom=this.bottom,Q.object.near=this.near,Q.object.far=this.far,this.view!==null)Q.object.view=Object.assign({},this.view);return Q}}class QZ extends P5{constructor(){super(new T5(-5,5,5,-5,0.5,500));this.isDirectionalLightShadow=!0}}class S5 extends C5{constructor(J,Q){super(J,Q);this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(z6.DEFAULT_UP),this.updateMatrix(),this.target=new z6,this.shadow=new QZ}dispose(){super.dispose(),this.shadow.dispose()}copy(J){return super.copy(J),this.target=J.target.clone(),this.shadow=J.shadow.clone(),this}toJSON(J){let Q=super.toJSON(J);return Q.object.shadow=this.shadow.toJSON(),Q.object.target=this.target.uuid,Q}}var z9=-90,V9=1;class D0 extends z6{constructor(J,Q,$){super();this.type="CubeCamera",this.renderTarget=$,this.coordinateSystem=null,this.activeMipmapLevel=0;let Z=new x6(z9,V9,J,Q);Z.layers=this.layers,this.add(Z);let W=new x6(z9,V9,J,Q);W.layers=this.layers,this.add(W);let q=new x6(z9,V9,J,Q);q.layers=this.layers,this.add(q);let K=new x6(z9,V9,J,Q);K.layers=this.layers,this.add(K);let H=new x6(z9,V9,J,Q);H.layers=this.layers,this.add(H);let U=new x6(z9,V9,J,Q);U.layers=this.layers,this.add(U)}updateCoordinateSystem(){let J=this.coordinateSystem,Q=this.children.concat(),[$,Z,W,q,K,H]=Q;for(let U of Q)this.remove(U);if(J===2000)$.up.set(0,1,0),$.lookAt(1,0,0),Z.up.set(0,1,0),Z.lookAt(-1,0,0),W.up.set(0,0,-1),W.lookAt(0,1,0),q.up.set(0,0,1),q.lookAt(0,-1,0),K.up.set(0,1,0),K.lookAt(0,0,1),H.up.set(0,1,0),H.lookAt(0,0,-1);else if(J===2001)$.up.set(0,-1,0),$.lookAt(-1,0,0),Z.up.set(0,-1,0),Z.lookAt(1,0,0),W.up.set(0,0,1),W.lookAt(0,1,0),q.up.set(0,0,-1),q.lookAt(0,-1,0),K.up.set(0,-1,0),K.lookAt(0,0,1),H.up.set(0,-1,0),H.lookAt(0,0,-1);else throw Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+J);for(let U of Q)this.add(U),U.updateMatrixWorld()}update(J,Q){if(this.parent===null)this.updateMatrixWorld();let{renderTarget:$,activeMipmapLevel:Z}=this;if(this.coordinateSystem!==J.coordinateSystem)this.coordinateSystem=J.coordinateSystem,this.updateCoordinateSystem();let[W,q,K,H,U,Y]=this.children,X=J.getRenderTarget(),G=J.getActiveCubeFace(),N=J.getActiveMipmapLevel(),F=J.xr.enabled;J.xr.enabled=!1;let M=$.texture.mipmapsAutoUpdate;$.texture.mipmapsAutoUpdate=!1;let L=!1;if(J.isWebGLRenderer===!0)L=J.state.buffers.depth.getReversed();else L=J.reversedDepthBuffer;if(J.setRenderTarget($,0,Z),L&&J.autoClear===!1)J.clearDepth();if(J.render(Q,W),J.setRenderTarget($,1,Z),L&&J.autoClear===!1)J.clearDepth();if(J.render(Q,q),J.setRenderTarget($,2,Z),L&&J.autoClear===!1)J.clearDepth();if(J.render(Q,K),J.setRenderTarget($,3,Z),L&&J.autoClear===!1)J.clearDepth();if(J.render(Q,H),J.setRenderTarget($,4,Z),L&&J.autoClear===!1)J.clearDepth();if(J.render(Q,U),$.texture.mipmapsAutoUpdate=M,J.setRenderTarget($,5,Z),L&&J.autoClear===!1)J.clearDepth();J.render(Q,Y),J.setRenderTarget(X,G,N),J.xr.enabled=F,$.texture.needsPMREMUpdate=!0}}class uJ extends x6{constructor(J=[]){super();this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=J,this.perCameraFrustumCulled=!1}}var cJ="\\[\\]\\.:\\/",Fq=new RegExp("["+cJ+"]","g"),nJ="[^"+cJ+"]",Dq="[^"+cJ.replace("\\.","")+"]",Oq=/((?:WC+[\/:])*)/.source.replace("WC",nJ),Rq=/(WCOD+)?/.source.replace("WCOD",Dq),Mq=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",nJ),kq=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",nJ),Lq=new RegExp("^"+Oq+Rq+Mq+kq+"$"),Bq=["material","materials","bones","map"];class $Z{constructor(J,Q,$){let Z=$||Y6.parseTrackName(Q);this._targetGroup=J,this._bindings=J.subscribe_(Q,Z)}getValue(J,Q){this.bind();let $=this._targetGroup.nCachedObjects_,Z=this._bindings[$];if(Z!==void 0)Z.getValue(J,Q)}setValue(J,Q){let $=this._bindings;for(let Z=this._targetGroup.nCachedObjects_,W=$.length;Z!==W;++Z)$[Z].setValue(J,Q)}bind(){let J=this._bindings;for(let Q=this._targetGroup.nCachedObjects_,$=J.length;Q!==$;++Q)J[Q].bind()}unbind(){let J=this._bindings;for(let Q=this._targetGroup.nCachedObjects_,$=J.length;Q!==$;++Q)J[Q].unbind()}}class Y6{constructor(J,Q,$){this.path=Q,this.parsedPath=$||Y6.parseTrackName(Q),this.node=Y6.findNode(J,this.parsedPath.nodeName),this.rootNode=J,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(J,Q,$){if(!(J&&J.isAnimationObjectGroup))return new Y6(J,Q,$);else return new Y6.Composite(J,Q,$)}static sanitizeNodeName(J){return J.replace(/\s/g,"_").replace(Fq,"")}static parseTrackName(J){let Q=Lq.exec(J);if(Q===null)throw Error("THREE.PropertyBinding: Cannot parse trackName: "+J);let $={nodeName:Q[2],objectName:Q[3],objectIndex:Q[4],propertyName:Q[5],propertyIndex:Q[6]},Z=$.nodeName&&$.nodeName.lastIndexOf(".");if(Z!==void 0&&Z!==-1){let W=$.nodeName.substring(Z+1);if(Bq.indexOf(W)!==-1)$.nodeName=$.nodeName.substring(0,Z),$.objectName=W}if($.propertyName===null||$.propertyName.length===0)throw Error("THREE.PropertyBinding: can not parse propertyName from trackName: "+J);return $}static findNode(J,Q){if(Q===void 0||Q===""||Q==="."||Q===-1||Q===J.name||Q===J.uuid)return J;if(J.skeleton){let $=J.skeleton.getBoneByName(Q);if($!==void 0)return $}if(J.children){let $=function(W){for(let q=0;q<W.length;q++){let K=W[q];if(K.name===Q||K.uuid===Q)return K;let H=$(K.children);if(H)return H}return null},Z=$(J.children);if(Z)return Z}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(J,Q){J[Q]=this.targetObject[this.propertyName]}_getValue_array(J,Q){let $=this.resolvedProperty;for(let Z=0,W=$.length;Z!==W;++Z)J[Q++]=$[Z]}_getValue_arrayElement(J,Q){J[Q]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(J,Q){this.resolvedProperty.toArray(J,Q)}_setValue_direct(J,Q){this.targetObject[this.propertyName]=J[Q]}_setValue_direct_setNeedsUpdate(J,Q){this.targetObject[this.propertyName]=J[Q],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(J,Q){this.targetObject[this.propertyName]=J[Q],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(J,Q){let $=this.resolvedProperty;for(let Z=0,W=$.length;Z!==W;++Z)$[Z]=J[Q++]}_setValue_array_setNeedsUpdate(J,Q){let $=this.resolvedProperty;for(let Z=0,W=$.length;Z!==W;++Z)$[Z]=J[Q++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(J,Q){let $=this.resolvedProperty;for(let Z=0,W=$.length;Z!==W;++Z)$[Z]=J[Q++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(J,Q){this.resolvedProperty[this.propertyIndex]=J[Q]}_setValue_arrayElement_setNeedsUpdate(J,Q){this.resolvedProperty[this.propertyIndex]=J[Q],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(J,Q){this.resolvedProperty[this.propertyIndex]=J[Q],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(J,Q){this.resolvedProperty.fromArray(J,Q)}_setValue_fromArray_setNeedsUpdate(J,Q){this.resolvedProperty.fromArray(J,Q),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(J,Q){this.resolvedProperty.fromArray(J,Q),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(J,Q){this.bind(),this.getValue(J,Q)}_setValue_unbound(J,Q){this.bind(),this.setValue(J,Q)}bind(){let J=this.node,Q=this.parsedPath,$=Q.objectName,Z=Q.propertyName,W=Q.propertyIndex;if(!J)J=Y6.findNode(this.rootNode,Q.nodeName),this.node=J;if(this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!J){t8("PropertyBinding: No target node found for track: "+this.path+".");return}if($){let U=Q.objectIndex;switch($){case"materials":if(!J.material){e8("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!J.material.materials){e8("PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}J=J.material.materials;break;case"bones":if(!J.skeleton){e8("PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}J=J.skeleton.bones;for(let Y=0;Y<J.length;Y++)if(J[Y].name===U){U=Y;break}break;case"map":if("map"in J){J=J.map;break}if(!J.material){e8("PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!J.material.map){e8("PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}J=J.material.map;break;default:if(J[$]===void 0){e8("PropertyBinding: Can not bind to objectName of node undefined.",this);return}J=J[$]}if(U!==void 0){if(J[U]===void 0){e8("PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,J);return}J=J[U]}}let q=J[Z];if(q===void 0){let U=Q.nodeName;e8("PropertyBinding: Trying to update property for track: "+U+"."+Z+" but it wasn't found.",J);return}let K=this.Versioning.None;if(this.targetObject=J,J.isMaterial===!0)K=this.Versioning.NeedsUpdate;else if(J.isObject3D===!0)K=this.Versioning.MatrixWorldNeedsUpdate;let H=this.BindingType.Direct;if(W!==void 0){if(Z==="morphTargetInfluences"){if(!J.geometry){e8("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!J.geometry.morphAttributes){e8("PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}if(J.morphTargetDictionary[W]!==void 0)W=J.morphTargetDictionary[W]}H=this.BindingType.ArrayElement,this.resolvedProperty=q,this.propertyIndex=W}else if(q.fromArray!==void 0&&q.toArray!==void 0)H=this.BindingType.HasFromToArray,this.resolvedProperty=q;else if(Array.isArray(q))H=this.BindingType.EntireArray,this.resolvedProperty=q;else this.propertyName=Z;this.getValue=this.GetterByBindingType[H],this.setValue=this.SetterByBindingTypeAndVersioning[H][K]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}}Y6.Composite=$Z;Y6.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};Y6.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};Y6.prototype.GetterByBindingType=[Y6.prototype._getValue_direct,Y6.prototype._getValue_array,Y6.prototype._getValue_arrayElement,Y6.prototype._getValue_toArray];Y6.prototype.SetterByBindingTypeAndVersioning=[[Y6.prototype._setValue_direct,Y6.prototype._setValue_direct_setNeedsUpdate,Y6.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[Y6.prototype._setValue_array,Y6.prototype._setValue_array_setNeedsUpdate,Y6.prototype._setValue_array_setMatrixWorldNeedsUpdate],[Y6.prototype._setValue_arrayElement,Y6.prototype._setValue_arrayElement_setNeedsUpdate,Y6.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[Y6.prototype._setValue_fromArray,Y6.prototype._setValue_fromArray_setNeedsUpdate,Y6.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];var LX=new Float32Array(1);class ZZ{static{this.prototype.isMatrix2=!0}constructor(J,Q,$,Z){if(this.elements=[1,0,0,1],J!==void 0)this.set(J,Q,$,Z)}identity(){return this.set(1,0,0,1),this}fromArray(J,Q=0){for(let $=0;$<4;$++)this.elements[$]=J[$+Q];return this}set(J,Q,$,Z){let W=this.elements;return W[0]=J,W[2]=Q,W[1]=$,W[3]=Z,this}}var dQ=new L8;class O0{constructor(J=new L8(1/0,1/0),Q=new L8(-1/0,-1/0)){this.isBox2=!0,this.min=J,this.max=Q}set(J,Q){return this.min.copy(J),this.max.copy(Q),this}setFromPoints(J){this.makeEmpty();for(let Q=0,$=J.length;Q<$;Q++)this.expandByPoint(J[Q]);return this}setFromCenterAndSize(J,Q){let $=dQ.copy(Q).multiplyScalar(0.5);return this.min.copy(J).sub($),this.max.copy(J).add($),this}clone(){return new this.constructor().copy(this)}copy(J){return this.min.copy(J.min),this.max.copy(J.max),this}makeEmpty(){return this.min.x=this.min.y=1/0,this.max.x=this.max.y=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y}getCenter(J){return this.isEmpty()?J.set(0,0):J.addVectors(this.min,this.max).multiplyScalar(0.5)}getSize(J){return this.isEmpty()?J.set(0,0):J.subVectors(this.max,this.min)}expandByPoint(J){return this.min.min(J),this.max.max(J),this}expandByVector(J){return this.min.sub(J),this.max.add(J),this}expandByScalar(J){return this.min.addScalar(-J),this.max.addScalar(J),this}containsPoint(J){return J.x>=this.min.x&&J.x<=this.max.x&&J.y>=this.min.y&&J.y<=this.max.y}containsBox(J){return this.min.x<=J.min.x&&J.max.x<=this.max.x&&this.min.y<=J.min.y&&J.max.y<=this.max.y}getParameter(J,Q){return Q.set((J.x-this.min.x)/(this.max.x-this.min.x),(J.y-this.min.y)/(this.max.y-this.min.y))}intersectsBox(J){return J.max.x>=this.min.x&&J.min.x<=this.max.x&&J.max.y>=this.min.y&&J.min.y<=this.max.y}clampPoint(J,Q){return Q.copy(J).clamp(this.min,this.max)}distanceToPoint(J){return this.clampPoint(J,dQ).distanceTo(J)}intersect(J){if(this.min.max(J.min),this.max.min(J.max),this.isEmpty())this.makeEmpty();return this}union(J){return this.min.min(J.min),this.max.max(J.max),this}translate(J){return this.min.add(J),this.max.add(J),this}equals(J){return J.min.equals(this.min)&&J.max.equals(this.max)}}class i6{constructor(){this.type="ShapePath",this.color=new r8,this.subPaths=[],this.currentPath=null,this.userData={}}moveTo(J,Q){return this.currentPath=new V7,this.subPaths.push(this.currentPath),this.currentPath.moveTo(J,Q),this}lineTo(J,Q){return this.currentPath.lineTo(J,Q),this}quadraticCurveTo(J,Q,$,Z){return this.currentPath.quadraticCurveTo(J,Q,$,Z),this}bezierCurveTo(J,Q,$,Z,W,q){return this.currentPath.bezierCurveTo(J,Q,$,Z,W,q),this}splineThru(J){return this.currentPath.splineThru(J),this}toShapes(){function J(H,U){let Y=!1,X=U.length;for(let G=0,N=X-1;G<X;N=G++){let F=U[G],M=U[N];if(F.y>H.y!==M.y>H.y&&H.x<(M.x-F.x)*(H.y-F.y)/(M.y-F.y)+F.x)Y=!Y}return Y}function Q(H,U){let Y=U.getCenter(new L8);if(J(Y,H))return Y;let X=Y.y,G=[],N=H.length;for(let F=0;F<N;F++){let M=H[F],L=H[(F+1)%N];if(M.y>X!==L.y>X){let E=M.x+(X-M.y)*(L.x-M.x)/(L.y-M.y);G.push(E)}}if(G.length>1)G.sort((F,M)=>F-M),Y.x=(G[0]+G[1])/2;return Y}let $=this.userData.style&&this.userData.style.fillRule||"nonzero";if($!=="nonzero"&&$!=="evenodd")t8('Fill-rule "'+$+'" is not supported, falling back to "nonzero".'),$="nonzero";let Z=$==="nonzero"?(H)=>H!==0:(H)=>(H&1)!==0,W=[];for(let H of this.subPaths){let U=H.getPoints();if(U.length<3)continue;let Y=H7.area(U);if(Y===0)continue;let X=new O0;for(let G=0;G<U.length;G++)X.expandByPoint(U[G]);W.push({subPath:H,points:U,boundingBox:X,interiorPoint:Q(U,X),absArea:Math.abs(Y),winding:Y<0?-1:1,container:null,exclude:!1,role:null})}W.sort((H,U)=>U.absArea-H.absArea);for(let H=0;H<W.length;H++){let U=W[H],Y=0;for(let X=H-1;X>=0;X--){let G=W[X];if(!G.boundingBox.containsBox(U.boundingBox))continue;if(!J(U.interiorPoint,G.points))continue;U.container=G.exclude?G.container:G,Y=G.winding,U.winding+=Y;break}if(Z(U.winding)===Z(Y))U.exclude=!0}for(let H of W){if(H.exclude)continue;H.role=H.container===null||H.container.role==="hole"?"outer":"hole"}let q=[],K=new Map;for(let H of W){if(H.exclude||H.role!=="outer")continue;let U=new V5;U.curves=H.subPath.curves,q.push(U),K.set(H,U)}for(let H of W){if(H.exclude||H.role!=="hole")continue;let U=K.get(H.container);if(!U)continue;let Y=new V7;Y.curves=H.subPath.curves,U.holes.push(Y)}return q}}function sJ(J,Q,$,Z){let W=zq(Z);switch($){case 1021:return J*Q;case 1028:return J*Q/W.components*W.byteLength;case 1029:return J*Q/W.components*W.byteLength;case 1030:return J*Q*2/W.components*W.byteLength;case 1031:return J*Q*2/W.components*W.byteLength;case 1022:return J*Q*3/W.components*W.byteLength;case 1023:return J*Q*4/W.components*W.byteLength;case 1033:return J*Q*4/W.components*W.byteLength;case 33776:case 33777:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*8;case 33778:case 33779:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*16;case 35841:case 35843:return Math.max(J,16)*Math.max(Q,8)/4;case 35840:case 35842:return Math.max(J,8)*Math.max(Q,8)/2;case 36196:case 37492:case 37488:case 37489:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*8;case 37496:case 37490:case 37491:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*16;case 37808:return Math.floor((J+3)/4)*Math.floor((Q+3)/4)*16;case 37809:return Math.floor((J+4)/5)*Math.floor((Q+3)/4)*16;case 37810:return Math.floor((J+4)/5)*Math.floor((Q+4)/5)*16;case 37811:return Math.floor((J+5)/6)*Math.floor((Q+4)/5)*16;case 37812:return Math.floor((J+5)/6)*Math.floor((Q+5)/6)*16;case 37813:return Math.floor((J+7)/8)*Math.floor((Q+4)/5)*16;case 37814:return Math.floor((J+7)/8)*Math.floor((Q+5)/6)*16;case 37815:return Math.floor((J+7)/8)*Math.floor((Q+7)/8)*16;case 37816:return Math.floor((J+9)/10)*Math.floor((Q+4)/5)*16;case 37817:return Math.floor((J+9)/10)*Math.floor((Q+5)/6)*16;case 37818:return Math.floor((J+9)/10)*Math.floor((Q+7)/8)*16;case 37819:return Math.floor((J+9)/10)*Math.floor((Q+9)/10)*16;case 37820:return Math.floor((J+11)/12)*Math.floor((Q+9)/10)*16;case 37821:return Math.floor((J+11)/12)*Math.floor((Q+11)/12)*16;case 36492:case 36494:case 36495:return Math.ceil(J/4)*Math.ceil(Q/4)*16;case 36283:case 36284:return Math.ceil(J/4)*Math.ceil(Q/4)*8;case 36285:case 36286:return Math.ceil(J/4)*Math.ceil(Q/4)*16}throw Error(`Unable to determine texture byte length for ${$} format.`)}function zq(J){switch(J){case 1009:case 1010:return{byteLength:1,components:1};case 1012:case 1011:case 1016:return{byteLength:2,components:1};case 1017:case 1018:return{byteLength:2,components:4};case 1014:case 1013:case 1015:return{byteLength:4,components:1};case 35902:case 35899:return{byteLength:4,components:3}}throw Error(`THREE.TextureUtils: Unknown texture type ${J}.`)}if(typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:"187"}}));if(typeof window<"u")if(window.__THREE__)t8("WARNING: Multiple instances of Three.js being imported.");else window.__THREE__="187";function AZ(){let J=null,Q=!1,$=null,Z=null;function W(q,K){Z=J.requestAnimationFrame(W),$(q,K)}return{start:function(){if(Q===!0)return;if($===null)return;if(J===null)return;Z=J.requestAnimationFrame(W),Q=!0},stop:function(){if(J!==null)J.cancelAnimationFrame(Z);Q=!1},setAnimationLoop:function(q){$=q},setContext:function(q){J=q}}}function Vq(J){let Q=new WeakMap;function $(H,U){let{array:Y,usage:X}=H,G=Y.byteLength,N=J.createBuffer();J.bindBuffer(U,N),J.bufferData(U,Y,X),H.onUploadCallback();let F;if(Y instanceof Float32Array)F=J.FLOAT;else if(typeof Float16Array<"u"&&Y instanceof Float16Array)F=J.HALF_FLOAT;else if(Y instanceof Uint16Array)if(H.isFloat16BufferAttribute)F=J.HALF_FLOAT;else F=J.UNSIGNED_SHORT;else if(Y instanceof Int16Array)F=J.SHORT;else if(Y instanceof Uint32Array)F=J.UNSIGNED_INT;else if(Y instanceof Int32Array)F=J.INT;else if(Y instanceof Int8Array)F=J.BYTE;else if(Y instanceof Uint8Array)F=J.UNSIGNED_BYTE;else if(Y instanceof Uint8ClampedArray)F=J.UNSIGNED_BYTE;else throw Error("THREE.WebGLAttributes: Unsupported buffer data format: "+Y);return{buffer:N,type:F,bytesPerElement:Y.BYTES_PER_ELEMENT,version:H.version,size:G}}function Z(H,U,Y){let{array:X,updateRanges:G}=U;if(J.bindBuffer(Y,H),G.length===0)J.bufferSubData(Y,0,X);else{G.sort((F,M)=>F.start-M.start);let N=0;for(let F=1;F<G.length;F++){let M=G[N],L=G[F];if(L.start<=M.start+M.count+1)M.count=Math.max(M.count,L.start+L.count-M.start);else++N,G[N]=L}G.length=N+1;for(let F=0,M=G.length;F<M;F++){let L=G[F];J.bufferSubData(Y,L.start*X.BYTES_PER_ELEMENT,X,L.start,L.count)}U.clearUpdateRanges()}U.onUploadCallback()}function W(H){if(H.isInterleavedBufferAttribute)H=H.data;return Q.get(H)}function q(H){if(H.isInterleavedBufferAttribute)H=H.data;let U=Q.get(H);if(U)J.deleteBuffer(U.buffer),Q.delete(H)}function K(H,U){if(H.isInterleavedBufferAttribute)H=H.data;if(H.isGLBufferAttribute){let X=Q.get(H);if(!X||X.version<H.version)Q.set(H,{buffer:H.buffer,type:H.type,bytesPerElement:H.elementSize,version:H.version});return}let Y=Q.get(H);if(Y===void 0)Q.set(H,$(H,U));else if(Y.version<H.version){if(Y.size!==H.array.byteLength)throw Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");Z(Y.buffer,H,U),Y.version=H.version}}return{get:W,remove:q,update:K}}var Iq=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,Aq=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,_q=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,Cq=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,Pq=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,wq=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Tq=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,Sq=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,jq=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec4 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 );
	}
#endif`,yq=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,vq=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,fq=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bq=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,hq=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,xq=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,gq=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,pq=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,mq=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,lq=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,dq=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#endif`,uq=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#endif`,cq=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec4 vColor;
#endif`,nq=`#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec4( 1.0 );
#endif
#ifdef USE_COLOR_ALPHA
	vColor *= color;
#elif defined( USE_COLOR )
	vColor.rgb *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.rgb *= instanceColor.rgb;
#endif
#ifdef USE_BATCHING_COLOR
	vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,sq=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
#define inverseTransformDirection transformDirectionByInverseViewMatrix
vec3 transformNormalByInverseViewMatrix( in vec3 normal, in mat4 viewMatrix ) {
	return normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
}
vec3 transformDirectionByInverseViewMatrix( in vec3 dir, in mat4 viewMatrix ) {
	return normalize( ( vec4( dir, 0.0 ) * viewMatrix ).xyz );
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,iq=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
#endif`,oq=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,aq=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,rq=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,tq=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,eq="gl_FragColor = linearToOutputTexel( gl_FragColor );",JK=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,QK=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * reflectVec );
		#ifdef ENVMAP_BLENDING_MULTIPLY
			outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_MIX )
			outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
		#elif defined( ENVMAP_BLENDING_ADD )
			outgoingLight += envColor.xyz * specularStrength * reflectivity;
		#endif
	#endif
#endif`,$K=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform mat3 envMapRotation;
	uniform samplerCube envMap;
	#ifdef ENVMAP_TYPE_PMREM
		float roughnessToMip( const in float roughness ) {
			float r = clamp( roughness, 0.0, 1.0 );
			return ENVMAP_MAX_LOD * r * ( 2.0 - r );
		}
	#endif
#endif`,ZK=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,WK=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,qK=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,KK=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,HK=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,UK=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,YK=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,XK=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,GK=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,NK=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,EK=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,FK=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_SUN_LIGHTS > 0
	struct SunLight {
		vec3 direction;
		vec3 color;
	};
	uniform SunLight sunLights[ NUM_SUN_LIGHTS ];
	void getSunLightInfo( const in SunLight sunLight, out IncidentLight light ) {
		light.color = sunLight.color;
		light.direction = sunLight.direction;
		light.visible = true;
	}
#endif
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif
#include <lightprobes_pars_fragment>`,DK=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_PMREM
			vec3 worldNormal = transformNormalByInverseViewMatrix( normal, viewMatrix );
			vec4 envMapColor = textureLod( envMap, envMapRotation * worldNormal, ENVMAP_MAX_LOD );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_PMREM
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, pow4( roughness ) ) );
			reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );
			vec4 envMapColor = textureLod( envMap, envMapRotation * reflectVec, roughnessToMip( roughness ) );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_RETROREFLECTION
		vec3 getIBLRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
			#ifdef ENVMAP_TYPE_PMREM
				vec3 retroVec = normalize( mix( viewDir, normal, pow4( roughness ) ) );
				retroVec = transformDirectionByInverseViewMatrix( retroVec, viewMatrix );
				vec4 envMapColor = textureLod( envMap, envMapRotation * retroVec, roughnessToMip( roughness ) );
				return envMapColor.rgb * envMapIntensity;
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_PMREM
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
		#ifdef USE_RETROREFLECTION
			vec3 getIBLAnisotropyRetroRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
				#ifdef ENVMAP_TYPE_PMREM
					vec3 bentNormal = cross( bitangent, viewDir );
					bentNormal = normalize( cross( bentNormal, bitangent ) );
					bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
					return getIBLRetroRadiance( viewDir, bentNormal, roughness );
				#else
					return vec3( 0.0 );
				#endif
			}
		#endif
	#endif
#endif`,OK=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,RK=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,MK=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,kK=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,LK=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.diffuseContribution = diffuseColor.rgb * ( 1.0 - metalnessFactor );
material.metalness = metalnessFactor;
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.045 );
material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef USE_DIFFUSE_ROUGHNESS
	float diffuseRoughnessFactor = diffuseRoughness;
	#ifdef USE_DIFFUSE_ROUGHNESSMAP
		diffuseRoughnessFactor *= texture2D( diffuseRoughnessMap, vDiffuseRoughnessMapUv ).r;
	#endif
	material.diffuseRoughness = saturate( diffuseRoughnessFactor );
#endif
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = vec3( 0.04 );
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.045 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_RETROREFLECTION
	material.retroreflectivity = retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.0001, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,BK=`uniform sampler2D dfgLUT;
struct PhysicalMaterial {
	vec3 diffuseColor;
	vec3 diffuseContribution;
	vec3 specularColor;
	vec3 specularColorBlended;
	float roughness;
	float metalness;
	float specularF90;
	float dispersion;
	vec2 dfg;
	vec3 multiScatteringCompensation;
	#ifdef USE_DIFFUSE_ROUGHNESS
		float diffuseRoughness;
	#endif
	#ifdef USE_RETROREFLECTION
		float retroreflectivity;
	#endif
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0Dielectric;
		vec3 iridescenceF0Metallic;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
#ifdef USE_DIFFUSE_ROUGHNESS
	const float EON_EPSILON = 1e-7;
	float FON_DirectionalAlbedo( const in float mu, const in float roughness, const in float A ) {
		float muComp = 1.0 - mu;
		float gOverPi = muComp * ( 0.0571085289 + muComp * ( 0.491881867 + muComp * ( - 0.332181442 + muComp * 0.0714429953 ) ) );
		return A * ( 1.0 + roughness * gOverPi );
	}
	vec3 BRDF_EON( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 diffuseColor, const in float roughness ) {
		vec3 rho = saturate( diffuseColor );
		if ( roughness <= EON_EPSILON ) return BRDF_Lambert( rho );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float s = dot( lightDir, viewDir ) - dotNL * dotNV;
		float sOverT = ( s > 0.0 ) ? s / max( max( dotNL, dotNV ), EON_EPSILON ) : s;
		float A = 1.0 / ( 1.0 + ( 0.5 - 2.0 / ( 3.0 * PI ) ) * roughness );
		vec3 singleScatter = rho * RECIPROCAL_PI * A * ( 1.0 + roughness * sOverT );
		float averageAlbedo = A * ( 1.0 + ( 2.0 / 3.0 - 28.0 / ( 15.0 * PI ) ) * roughness );
		float albedoV = FON_DirectionalAlbedo( dotNV, roughness, A );
		float albedoL = FON_DirectionalAlbedo( dotNL, roughness, A );
		vec3 rhoMultiScatter = rho * rho * averageAlbedo / max( vec3( EON_EPSILON ), vec3( 1.0 ) - rho * ( 1.0 - averageAlbedo ) );
		vec3 multiScatter = rhoMultiScatter * RECIPROCAL_PI
			* max( EON_EPSILON, 1.0 - albedoV )
			* max( EON_EPSILON, 1.0 - albedoL )
			/ max( EON_EPSILON, 1.0 - averageAlbedo );
		return singleScatter + multiScatter;
	}
	vec3 EON_DirectionalAlbedo( const in vec3 diffuseColor, const in float roughness, const in float dotNV ) {
		vec3 rho = saturate( diffuseColor );
		if ( roughness <= EON_EPSILON ) return rho;
		float A = 1.0 / ( 1.0 + ( 0.5 - 2.0 / ( 3.0 * PI ) ) * roughness );
		float directionalAlbedo = FON_DirectionalAlbedo( dotNV, roughness, A );
		float averageAlbedo = A * ( 1.0 + ( 2.0 / 3.0 - 28.0 / ( 15.0 * PI ) ) * roughness );
		vec3 rhoMultiScatter = rho * rho * averageAlbedo / max( vec3( EON_EPSILON ), vec3( 1.0 ) - rho * ( 1.0 - averageAlbedo ) );
		return rho * directionalAlbedo + rhoMultiScatter * ( 1.0 - directionalAlbedo );
	}
#endif
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		return 0.5 / max( gv + gl, EPSILON );
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = max( material.clearcoatRoughness, 0.045 );
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColorBlended;
	float f90 = material.specularF90;
	float roughness = max( material.roughness, 0.045 );
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float alphaT = max( material.alphaT, alpha );
		float V = V_GGX_SmithCorrelated_Anisotropic( alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transpose( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float rInv = 1.0 / ( roughness + 0.1 );
	float a = -1.9362 + 1.0678 * roughness + 0.4573 * r2 - 0.8469 * rInv;
	float b = -0.6014 + 0.5538 * roughness - 0.4670 * r2 - 0.1255 * rInv;
	float DG = exp( a * dotNV + b );
	return saturate( DG );
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	vec2 fab = texture2D( dfgLUT, vec2( roughness, dotNV ) ).rg;
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec2 fab, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec2 fab, const in vec3 specularColor, const in float specularF90, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColorBlended * t2.x + ( material.specularF90 - material.specularColorBlended ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseContribution * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
		#ifdef USE_CLEARCOAT
			vec3 Ncc = geometryClearcoatNormal;
			vec2 uvClearcoat = LTC_Uv( Ncc, viewDir, material.clearcoatRoughness );
			vec4 t1Clearcoat = texture2D( ltc_1, uvClearcoat );
			vec4 t2Clearcoat = texture2D( ltc_2, uvClearcoat );
			mat3 mInvClearcoat = mat3(
				vec3( t1Clearcoat.x, 0, t1Clearcoat.y ),
				vec3(             0, 1,             0 ),
				vec3( t1Clearcoat.z, 0, t1Clearcoat.w )
			);
			vec3 fresnelClearcoat = material.clearcoatF0 * t2Clearcoat.x + ( material.clearcoatF90 - material.clearcoatF0 ) * t2Clearcoat.y;
			clearcoatSpecularDirect += lightColor * fresnelClearcoat * LTC_Evaluate( Ncc, viewDir, position, mInvClearcoat, rectCoords );
		#endif
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
 
 		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
 
 		float sheenAlbedoV = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
 		float sheenAlbedoL = IBLSheenBRDF( geometryNormal, directLight.direction, material.sheenRoughness );
 
 		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * max( sheenAlbedoV, sheenAlbedoL );
 
 		irradiance *= sheenEnergyComp;
 
 	#endif
	vec3 specularBRDF = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	#ifdef USE_RETROREFLECTION
		vec3 retroViewDir = reflect( - geometryViewDir, geometryNormal );
		vec3 retroSpecularBRDF = BRDF_GGX( directLight.direction, retroViewDir, geometryNormal, material );
		specularBRDF = mix( specularBRDF, retroSpecularBRDF, saturate( material.retroreflectivity ) );
	#endif
	reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
	vec3 halfDir = normalize( directLight.direction + geometryViewDir );
	float dotVH = saturate( dot( geometryViewDir, halfDir ) );
	vec3 F = F_Schlick( material.specularColor, material.specularF90, dotVH );
	#ifdef USE_RETROREFLECTION
		vec3 retroHalfDir = normalize( directLight.direction + retroViewDir );
		float dotRetroVH = saturate( dot( retroViewDir, retroHalfDir ) );
		vec3 retroF = F_Schlick( material.specularColor, material.specularF90, dotRetroVH );
		F = mix( F, retroF, saturate( material.retroreflectivity ) );
	#endif
	#ifdef USE_DIFFUSE_ROUGHNESS
		vec3 diffuseBRDF = BRDF_EON( directLight.direction, geometryViewDir, geometryNormal, material.diffuseColor, material.diffuseRoughness ) * ( 1.0 - material.metalness );
	#else
		vec3 diffuseBRDF = BRDF_Lambert( material.diffuseContribution );
	#endif
	reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScattering, multiScattering );
	#endif
	#ifdef USE_DIFFUSE_ROUGHNESS
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 diffuseAlbedo = EON_DirectionalAlbedo( material.diffuseColor, material.diffuseRoughness, dotNV ) * ( 1.0 - material.metalness );
		vec3 diffuse = irradiance * RECIPROCAL_PI * diffuseAlbedo * ( 1.0 - singleScattering - multiScattering );
	#else
		vec3 diffuse = irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - singleScattering - multiScattering );
	#endif
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		sheenSpecularIndirect += irradiance * material.sheenColor * sheenAlbedo * RECIPROCAL_PI;
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		diffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectDiffuse += diffuse;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness ) * RECIPROCAL_PI;
 	#endif
	vec3 singleScatteringDielectric = vec3( 0.0 );
	vec3 multiScatteringDielectric = vec3( 0.0 );
	vec3 singleScatteringMetallic = vec3( 0.0 );
	vec3 multiScatteringMetallic = vec3( 0.0 );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( material.dfg, material.specularColor, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscatteringIridescence( material.dfg, material.diffuseColor, material.specularF90, material.iridescence, material.iridescenceF0Metallic, singleScatteringMetallic, multiScatteringMetallic );
	#else
		computeMultiscattering( material.dfg, material.specularColor, material.specularF90, singleScatteringDielectric, multiScatteringDielectric );
		computeMultiscattering( material.dfg, material.diffuseColor, material.specularF90, singleScatteringMetallic, multiScatteringMetallic );
	#endif
	vec3 singleScattering = mix( singleScatteringDielectric, singleScatteringMetallic, material.metalness );
	vec3 multiScattering = mix( multiScatteringDielectric, multiScatteringMetallic, material.metalness );
	vec3 totalScatteringDielectric = singleScatteringDielectric + multiScatteringDielectric;
	#ifdef USE_DIFFUSE_ROUGHNESS
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		vec3 diffuse = EON_DirectionalAlbedo( material.diffuseColor, material.diffuseRoughness, dotNV ) * ( 1.0 - material.metalness ) * ( 1.0 - totalScatteringDielectric );
	#else
		vec3 diffuse = material.diffuseContribution * ( 1.0 - totalScatteringDielectric );
	#endif
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec3 indirectSpecular = radiance * singleScattering;
	indirectSpecular += multiScattering * cosineWeightedIrradiance;
	vec3 indirectDiffuse = diffuse * cosineWeightedIrradiance;
	#ifdef USE_SHEEN
		float sheenAlbedo = IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
		float sheenEnergyComp = 1.0 - max3( material.sheenColor ) * sheenAlbedo;
		indirectSpecular *= sheenEnergyComp;
		indirectDiffuse *= sheenEnergyComp;
	#endif
	reflectedLight.indirectSpecular += indirectSpecular;
	reflectedLight.indirectDiffuse += indirectDiffuse;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,zK=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		vec3 iridescenceFresnelDielectric = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		vec3 iridescenceFresnelMetallic = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.diffuseColor );
		material.iridescenceFresnel = mix( iridescenceFresnelDielectric, iridescenceFresnelMetallic, material.metalness );
		material.iridescenceF0Dielectric = Schlick_to_F0( iridescenceFresnelDielectric, 1.0, dotNVi );
		material.iridescenceF0Metallic = Schlick_to_F0( iridescenceFresnelMetallic, 1.0, dotNVi );
	}
#endif
#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
	SunLight sunLight;
	#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHTS; i ++ ) {
		sunLight = sunLights[ i ];
		getSunLightInfo( sunLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SUN_LIGHT_SHADOWS )
		sunLightShadow = sunLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getSunShadow( sunShadowMap[ i ], sunLightShadow, UNROLLED_LOOP_INDEX ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_LIGHT_PROBE_GRIDS > 0
		vec3 probeWorldPos = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
		vec3 probeWorldNormal = transformNormalByInverseViewMatrix( geometryNormal, viewMatrix );
		int probeGrid = - 1;
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_LIGHT_PROBE_GRIDS; i ++ ) {
			if ( isInsideLightProbeGrid( probeWorldPos, probeWorldNormal, probesMin[ i ], probesMax[ i ], probesResolution[ i ] ) ) probeGrid = UNROLLED_LOOP_INDEX;
		}
		#pragma unroll_loop_end
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_LIGHT_PROBE_GRIDS; i ++ ) {
			if ( probeGrid == UNROLLED_LOOP_INDEX ) irradiance += getLightProbeGridIrradiance( probesSH[ i ], probesMin[ i ], probesMax[ i ], probesResolution[ i ], probeWorldPos, probeWorldNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,VK=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
		#if defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG )
			iblIrradiance += getIBLIrradiance( geometryNormal );
		#endif
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		vec3 iblRadiance = getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		vec3 iblRadiance = getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_RETROREFLECTION
		#ifdef USE_ANISOTROPY
			vec3 retroIBLRadiance = getIBLAnisotropyRetroRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
		#else
			vec3 retroIBLRadiance = getIBLRetroRadiance( geometryViewDir, geometryNormal, material.roughness );
		#endif
		iblRadiance = mix( iblRadiance, retroIBLRadiance, saturate( material.retroreflectivity ) );
	#endif
	radiance += iblRadiance;
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,IK=`#if defined( RE_IndirectDiffuse )
	#if defined( LAMBERT ) || defined( PHONG )
		irradiance += iblIrradiance;
	#endif
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,AK=`#if NUM_LIGHT_PROBE_GRIDS > 0
uniform highp sampler3D probesSH[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesMin[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesMax[ NUM_LIGHT_PROBE_GRIDS ];
uniform vec3 probesResolution[ NUM_LIGHT_PROBE_GRIDS ];
bool isInsideLightProbeGrid( vec3 worldPos, vec3 worldNormal, vec3 probesMin, vec3 probesMax, vec3 probesResolution ) {
	vec3 spacing = ( probesMax - probesMin ) / probesResolution;
	vec3 samplePos = worldPos + worldNormal * spacing * 0.5;
	vec3 margin = spacing * 0.01;
	return all( greaterThanEqual( samplePos, probesMin - margin ) ) && all( lessThanEqual( samplePos, probesMax + margin ) );
}
vec3 getLightProbeGridIrradiance( highp sampler3D probesSH, vec3 probesMin, vec3 probesMax, vec3 probesResolution, vec3 worldPos, vec3 worldNormal ) {
	vec3 res = probesResolution;
	vec3 gridRange = probesMax - probesMin;
	vec3 probeSpacing = gridRange / res;
	vec3 samplePos = worldPos + worldNormal * probeSpacing * 0.5;
	vec3 uvw = clamp( ( samplePos - probesMin ) / gridRange, 0.5 / res, 1.0 - 0.5 / res );
	float nz          = res.z;
	float paddedSlices = nz + 2.0;
	float atlasDepth  = 7.0 * paddedSlices;
	float uvZBase     = uvw.z * nz + 1.0;
	vec4 s0 = texture( probesSH, vec3( uvw.xy, ( uvZBase                       ) / atlasDepth ) );
	vec4 s1 = texture( probesSH, vec3( uvw.xy, ( uvZBase +       paddedSlices   ) / atlasDepth ) );
	vec4 s2 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 2.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s3 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 3.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s4 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 4.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s5 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 5.0 * paddedSlices   ) / atlasDepth ) );
	vec4 s6 = texture( probesSH, vec3( uvw.xy, ( uvZBase + 6.0 * paddedSlices   ) / atlasDepth ) );
	vec3 c0 = s0.xyz;
	vec3 c1 = vec3( s0.w, s1.xy );
	vec3 c2 = vec3( s1.zw, s2.x );
	vec3 c3 = s2.yzw;
	vec3 c4 = s3.xyz;
	vec3 c5 = vec3( s3.w, s4.xy );
	vec3 c6 = vec3( s4.zw, s5.x );
	vec3 c7 = s5.yzw;
	vec3 c8 = s6.xyz;
	float x = worldNormal.x, y = worldNormal.y, z = worldNormal.z;
	vec3 result = c0 * 0.886227;
	result += c1 * 2.0 * 0.511664 * y;
	result += c2 * 2.0 * 0.511664 * z;
	result += c3 * 2.0 * 0.511664 * x;
	result += c4 * 2.0 * 0.429043 * x * y;
	result += c5 * 2.0 * 0.429043 * y * z;
	result += c6 * ( 0.743125 * z * z - 0.247708 );
	result += c7 * 2.0 * 0.429043 * x * z;
	result += c8 * 0.429043 * ( x * x - y * y );
	return max( result, vec3( 0.0 ) );
}
#endif`,_K=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,CK=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,PK=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,wK=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,TK=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,SK=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,jK=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,yK=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,vK=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,fK=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,bK=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,hK=`#if defined( USE_MORPHCOLORS )
	#if defined( USE_COLOR_ALPHA )
		vColor *= morphTargetBaseInfluence;
	#elif defined( USE_COLOR )
		vColor.rgb *= morphTargetBaseInfluence;
	#endif
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor.rgb += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,xK=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,gK=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,pK=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,mK=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#ifdef DOUBLE_SIDED
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#ifdef DOUBLE_SIDED
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,lK=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#if defined( USE_PACKED_NORMALMAP )
		mapN = vec3( mapN.xy, sqrt( saturate( 1.0 - dot( mapN.xy, mapN.xy ) ) ) );
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,dK=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,uK=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,cK=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
		#ifdef FLIP_SIDED
			vBitangent = - vBitangent;
		#endif
	#endif
#endif`,nK=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,sK=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,iK=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,oK=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,aK=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,rK=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,tK=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	#ifdef USE_REVERSED_DEPTH_BUFFER
	
		return depth * ( far - near ) - far;
	#else
		return depth * ( near - far ) - near;
	#endif
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	
	#ifdef USE_REVERSED_DEPTH_BUFFER
		return ( near * far ) / ( ( near - far ) * depth - near );
	#else
		return ( near * far ) / ( ( far - near ) * depth - far );
	#endif
}`,eK=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,JH=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,QH=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,$H=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,ZH=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,WH=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,qH=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		#define SUN_LIGHT_CASCADES 2
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#else
			uniform sampler2D sunShadowMap[ NUM_SUN_LIGHT_SHADOWS ];
		#endif
		uniform mat4 sunShadowMatrix[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		uniform vec4 sunShadowCascade[ NUM_SUN_LIGHT_SHADOWS * SUN_LIGHT_CASCADES ];
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
		struct SunLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SunLightShadow sunLightShadows[ NUM_SUN_LIGHT_SHADOWS ];
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#else
			uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		#endif
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform sampler2DShadow spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#else
			uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		#endif
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#if defined( SHADOWMAP_TYPE_PCF )
			uniform samplerCubeShadow pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#elif defined( SHADOWMAP_TYPE_BASIC )
			uniform samplerCube pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		#endif
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float interleavedGradientNoise( vec2 position ) {
			return fract( 52.9829189 * fract( dot( position, vec2( 0.06711056, 0.00583715 ) ) ) );
		}
		vec2 vogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
			const float goldenAngle = 2.399963229728653;
			float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
			float theta = float( sampleIndex ) * goldenAngle + phi;
			return vec2( cos( theta ), sin( theta ) ) * r;
		}
	#endif
	#if defined( SHADOWMAP_TYPE_PCF )
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				vec2 radius = shadowRadius * texelSize;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 1, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 2, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 3, 5, phi ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 4, 5, phi ) * radius, shadowCoord.z ) )
				) * 0.2;
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#elif defined( SHADOWMAP_TYPE_VSM )
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				vec2 distribution = texture2D( shadowMap, shadowCoord.xy ).rg;
				float mean = distribution.x;
				float variance = distribution.y * distribution.y;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					float hard_shadow = step( mean, shadowCoord.z );
				#else
					float hard_shadow = step( shadowCoord.z, mean );
				#endif
				
				if ( hard_shadow == 1.0 ) {
					shadow = 1.0;
				} else {
					variance = max( variance, 0.0000001 );
					float d = shadowCoord.z - mean;
					float p_max = variance / ( variance + d * d );
					p_max = clamp( ( p_max - 0.3 ) / 0.65, 0.0, 1.0 );
					shadow = max( hard_shadow, p_max );
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#else
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				shadowCoord.z -= shadowBias;
			#else
				shadowCoord.z += shadowBias;
			#endif
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
			if ( frustumTest ) {
				float depth = texture2D( shadowMap, shadowCoord.xy ).r;
				#ifdef USE_REVERSED_DEPTH_BUFFER
					shadow = step( depth, shadowCoord.z );
				#else
					shadow = step( shadowCoord.z, depth );
				#endif
			}
			return mix( 1.0, shadow, shadowIntensity );
		}
	#endif
	#if NUM_SUN_LIGHT_SHADOWS > 0
		float getSunShadow(
			#if defined( SHADOWMAP_TYPE_PCF )
				sampler2DShadow shadowMap,
			#else
				sampler2D shadowMap,
			#endif
			SunLightShadow sunLightShadow,
			int shadowIndex
		) {
			vec4 shadowWorldPosition = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			float viewDepth = vSunShadowWorldPosition.w;
			int cascadeOffset = shadowIndex * SUN_LIGHT_CASCADES;
			float shadow = 1.0;
			for ( int i = SUN_LIGHT_CASCADES - 1; i >= 0; i -- ) {
				vec4 cascade = sunShadowCascade[ cascadeOffset + i ];
				if ( viewDepth >= cascade.x && viewDepth < cascade.y ) {
					float cascadeShadow = getShadow(
						shadowMap,
						sunLightShadow.shadowMapSize,
						sunLightShadow.shadowIntensity,
						sunLightShadow.shadowBias,
						sunLightShadow.shadowRadius,
						sunShadowMatrix[ cascadeOffset + i ] * shadowWorldPosition
					);
					shadow = mix( cascadeShadow, shadow, smoothstep( cascade.z, cascade.y, viewDepth ) );
				}
			}
			return shadow;
		}
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	#if defined( SHADOWMAP_TYPE_PCF )
	float getPointShadow( samplerCubeShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 bd3D = normalize( lightToPosition );
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float lightDistance = length( lightToPosition );
			float depthRange = shadowCameraFar - shadowCameraNear;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float depthA = - shadowCameraNear / depthRange - shadowBias;
				float depthB = shadowCameraNear * shadowCameraFar / ( depthRange * lightDistance );
			#else
				float depthA = shadowCameraFar / depthRange + shadowBias;
				float depthB = - shadowCameraNear * shadowCameraFar / ( depthRange * lightDistance );
			#endif
			float texelSize = shadowRadius / shadowMapSize.x;
			vec3 absDir = abs( bd3D );
			vec3 tangent = absDir.x > absDir.z ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
			tangent = normalize( cross( bd3D, tangent ) );
			vec3 bitangent = cross( bd3D, tangent );
			float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
			shadow = 0.0;
			for ( int i = 0; i < 5; i ++ ) {
				vec2 offset = vogelDiskSample( i, 5, phi );
				vec3 direction = bd3D + ( tangent * offset.x + bitangent * offset.y ) * texelSize;
				vec3 absDirection = abs( direction );
				float dp = depthA + depthB / max( max( absDirection.x, absDirection.y ), absDirection.z );
				shadow += texture( shadowMap, vec4( direction, dp ) );
			}
			shadow *= 0.2;
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#elif defined( SHADOWMAP_TYPE_BASIC )
	float getPointShadow( samplerCube shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		vec3 absVec = abs( lightToPosition );
		float viewSpaceZ = max( max( absVec.x, absVec.y ), absVec.z );
		if ( viewSpaceZ - shadowCameraFar <= 0.0 && viewSpaceZ - shadowCameraNear >= 0.0 ) {
			float dp = ( shadowCameraFar * ( viewSpaceZ - shadowCameraNear ) ) / ( viewSpaceZ * ( shadowCameraFar - shadowCameraNear ) );
			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			float depth = textureCube( shadowMap, bd3D ).r;
			#ifdef USE_REVERSED_DEPTH_BUFFER
				depth = 1.0 - depth;
			#endif
			shadow = step( dp, depth );
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	#endif
	#endif
#endif`,KH=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
		varying vec4 vSunShadowWorldPosition;
		varying vec3 vSunShadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,HH=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_SUN_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	#ifdef HAS_NORMAL
		vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );
	#else
		vec3 shadowWorldNormal = vec3( 0.0 );
	#endif
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_SUN_LIGHT_SHADOWS > 0
		vSunShadowWorldPosition = vec4( worldPosition.xyz, - mvPosition.z );
		vSunShadowWorldNormal = shadowWorldNormal;
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,UH=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_SUN_LIGHT_SHADOWS > 0
	SunLightShadow sunLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SUN_LIGHT_SHADOWS; i ++ ) {
		sunLight = sunLightShadows[ i ];
		shadow *= receiveShadow ? getSunShadow( sunShadowMap[ i ], sunLight, UNROLLED_LOOP_INDEX ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0 && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_BASIC ) )
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,YH=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,XH=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,GH=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,NH=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,EH=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,FH=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,DH=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,OH=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,RH=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = transformNormalByInverseViewMatrix( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseContribution, material.specularColorBlended, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,MH=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,kH=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	varying vec2 vDiffuseRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,LH=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	uniform mat3 diffuseRoughnessMapTransform;
	varying vec2 vDiffuseRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,BH=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DIFFUSE_ROUGHNESSMAP
	vDiffuseRoughnessMapUv = ( diffuseRoughnessMapTransform * vec3( DIFFUSE_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,zH=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`,VH=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,IH=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,AH=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,_H=`uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <envmap_common_pars_fragment>
void main() {
	#ifdef ENVMAP_TYPE_PMREM
		vec4 texColor = textureLod( envMap, backgroundRotation * vWorldDirection, roughnessToMip( backgroundBlurriness ) );
	#else
		vec4 texColor = textureCube( envMap, backgroundRotation * vWorldDirection );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,CH=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,PH=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,wH=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,TH=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,SH=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,jH=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
}`,yH=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,vH=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,fH=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,bH=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,hH=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,xH=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,gH=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,pH=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,mH=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,lH=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,dH=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,uH=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,cH=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,nH=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,sH=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,iH=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DIFFUSE_ROUGHNESS
	uniform float diffuseRoughness;
	#ifdef USE_DIFFUSE_ROUGHNESSMAP
		uniform sampler2D diffuseRoughnessMap;
	#endif
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_RETROREFLECTION
	uniform float retroreflectivity;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
 
		outgoingLight = outgoingLight + sheenSpecularDirect + sheenSpecularIndirect;
 
 	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,oH=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,aH=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,rH=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,tH=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,eH=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,JU=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,QU=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,$U=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,$6={alphahash_fragment:Iq,alphahash_pars_fragment:Aq,alphamap_fragment:_q,alphamap_pars_fragment:Cq,alphatest_fragment:Pq,alphatest_pars_fragment:wq,aomap_fragment:Tq,aomap_pars_fragment:Sq,batching_pars_vertex:jq,batching_vertex:yq,begin_vertex:vq,beginnormal_vertex:fq,bsdfs:bq,iridescence_fragment:hq,bumpmap_pars_fragment:xq,clipping_planes_fragment:gq,clipping_planes_pars_fragment:pq,clipping_planes_pars_vertex:mq,clipping_planes_vertex:lq,color_fragment:dq,color_pars_fragment:uq,color_pars_vertex:cq,color_vertex:nq,common:sq,defaultnormal_vertex:iq,displacementmap_pars_vertex:oq,displacementmap_vertex:aq,emissivemap_fragment:rq,emissivemap_pars_fragment:tq,colorspace_fragment:eq,colorspace_pars_fragment:JK,envmap_fragment:QK,envmap_common_pars_fragment:$K,envmap_pars_fragment:ZK,envmap_pars_vertex:WK,envmap_physical_pars_fragment:DK,envmap_vertex:qK,fog_vertex:KK,fog_pars_vertex:HK,fog_fragment:UK,fog_pars_fragment:YK,gradientmap_pars_fragment:XK,lightmap_pars_fragment:GK,lights_lambert_fragment:NK,lights_lambert_pars_fragment:EK,lights_pars_begin:FK,lights_toon_fragment:OK,lights_toon_pars_fragment:RK,lights_phong_fragment:MK,lights_phong_pars_fragment:kK,lights_physical_fragment:LK,lights_physical_pars_fragment:BK,lights_fragment_begin:zK,lights_fragment_maps:VK,lights_fragment_end:IK,lightprobes_pars_fragment:AK,logdepthbuf_fragment:_K,logdepthbuf_pars_fragment:CK,logdepthbuf_pars_vertex:PK,logdepthbuf_vertex:wK,map_fragment:TK,map_pars_fragment:SK,map_particle_fragment:jK,map_particle_pars_fragment:yK,metalnessmap_fragment:vK,metalnessmap_pars_fragment:fK,morphinstance_vertex:bK,morphcolor_vertex:hK,morphnormal_vertex:xK,morphtarget_pars_vertex:gK,morphtarget_vertex:pK,normal_fragment_begin:mK,normal_fragment_maps:lK,normal_pars_fragment:dK,normal_pars_vertex:uK,normal_vertex:cK,normalmap_pars_fragment:nK,clearcoat_normal_fragment_begin:sK,clearcoat_normal_fragment_maps:iK,clearcoat_pars_fragment:oK,iridescence_pars_fragment:aK,opaque_fragment:rK,packing:tK,premultiplied_alpha_fragment:eK,project_vertex:JH,dithering_fragment:QH,dithering_pars_fragment:$H,roughnessmap_fragment:ZH,roughnessmap_pars_fragment:WH,shadowmap_pars_fragment:qH,shadowmap_pars_vertex:KH,shadowmap_vertex:HH,shadowmask_pars_fragment:UH,skinbase_vertex:YH,skinning_pars_vertex:XH,skinning_vertex:GH,skinnormal_vertex:NH,specularmap_fragment:EH,specularmap_pars_fragment:FH,tonemapping_fragment:DH,tonemapping_pars_fragment:OH,transmission_fragment:RH,transmission_pars_fragment:MH,uv_pars_fragment:kH,uv_pars_vertex:LH,uv_vertex:BH,worldpos_vertex:zH,background_vert:VH,background_frag:IH,backgroundCube_vert:AH,backgroundCube_frag:_H,cube_vert:CH,cube_frag:PH,depth_vert:wH,depth_frag:TH,distance_vert:SH,distance_frag:jH,equirect_vert:yH,equirect_frag:vH,linedashed_vert:fH,linedashed_frag:bH,meshbasic_vert:hH,meshbasic_frag:xH,meshlambert_vert:gH,meshlambert_frag:pH,meshmatcap_vert:mH,meshmatcap_frag:lH,meshnormal_vert:dH,meshnormal_frag:uH,meshphong_vert:cH,meshphong_frag:nH,meshphysical_vert:sH,meshphysical_frag:iH,meshtoon_vert:oH,meshtoon_frag:aH,points_vert:rH,points_frag:tH,shadow_vert:eH,shadow_frag:JU,sprite_vert:QU,sprite_frag:$U},h8={common:{diffuse:{value:new r8(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new i8},alphaMap:{value:null},alphaMapTransform:{value:new i8},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new i8}},envmap:{envMap:{value:null},envMapRotation:{value:new i8},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:0.98},dfgLUT:{value:null}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new i8}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new i8}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new i8},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new i8},normalScale:{value:new L8(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new i8},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new i8}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new i8}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new i8}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:0.00025},fogNear:{value:1},fogFar:{value:2000},fogColor:{value:new r8(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},sunLights:{value:[],properties:{direction:{},color:{}}},sunLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},sunShadowMatrix:{value:[]},sunShadowCascade:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null},probesSH:{value:[]},probesMin:{value:[]},probesMax:{value:[]},probesResolution:{value:[]}},points:{diffuse:{value:new r8(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new i8},alphaTest:{value:0},uvTransform:{value:new i8}},sprite:{diffuse:{value:new r8(16777215)},opacity:{value:1},center:{value:new L8(0.5,0.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new i8},alphaMap:{value:null},alphaMapTransform:{value:new i8},alphaTest:{value:0}}},E7={basic:{uniforms:b6([h8.common,h8.specularmap,h8.envmap,h8.aomap,h8.lightmap,h8.fog]),vertexShader:$6.meshbasic_vert,fragmentShader:$6.meshbasic_frag},lambert:{uniforms:b6([h8.common,h8.specularmap,h8.envmap,h8.aomap,h8.lightmap,h8.emissivemap,h8.bumpmap,h8.normalmap,h8.displacementmap,h8.fog,h8.lights,{emissive:{value:new r8(0)},envMapIntensity:{value:1}}]),vertexShader:$6.meshlambert_vert,fragmentShader:$6.meshlambert_frag},phong:{uniforms:b6([h8.common,h8.specularmap,h8.envmap,h8.aomap,h8.lightmap,h8.emissivemap,h8.bumpmap,h8.normalmap,h8.displacementmap,h8.fog,h8.lights,{emissive:{value:new r8(0)},specular:{value:new r8(1118481)},shininess:{value:30},envMapIntensity:{value:1}}]),vertexShader:$6.meshphong_vert,fragmentShader:$6.meshphong_frag},standard:{uniforms:b6([h8.common,h8.envmap,h8.aomap,h8.lightmap,h8.emissivemap,h8.bumpmap,h8.normalmap,h8.displacementmap,h8.roughnessmap,h8.metalnessmap,h8.fog,h8.lights,{emissive:{value:new r8(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:$6.meshphysical_vert,fragmentShader:$6.meshphysical_frag},toon:{uniforms:b6([h8.common,h8.aomap,h8.lightmap,h8.emissivemap,h8.bumpmap,h8.normalmap,h8.displacementmap,h8.gradientmap,h8.fog,h8.lights,{emissive:{value:new r8(0)}}]),vertexShader:$6.meshtoon_vert,fragmentShader:$6.meshtoon_frag},matcap:{uniforms:b6([h8.common,h8.bumpmap,h8.normalmap,h8.displacementmap,h8.fog,{matcap:{value:null}}]),vertexShader:$6.meshmatcap_vert,fragmentShader:$6.meshmatcap_frag},points:{uniforms:b6([h8.points,h8.fog]),vertexShader:$6.points_vert,fragmentShader:$6.points_frag},dashed:{uniforms:b6([h8.common,h8.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:$6.linedashed_vert,fragmentShader:$6.linedashed_frag},depth:{uniforms:b6([h8.common,h8.displacementmap]),vertexShader:$6.depth_vert,fragmentShader:$6.depth_frag},normal:{uniforms:b6([h8.common,h8.bumpmap,h8.normalmap,h8.displacementmap,{opacity:{value:1}}]),vertexShader:$6.meshnormal_vert,fragmentShader:$6.meshnormal_frag},sprite:{uniforms:b6([h8.sprite,h8.fog]),vertexShader:$6.sprite_vert,fragmentShader:$6.sprite_frag},background:{uniforms:{uvTransform:{value:new i8},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:$6.background_vert,fragmentShader:$6.background_frag},backgroundCube:{uniforms:{envMap:{value:null},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new i8}},vertexShader:$6.backgroundCube_vert,fragmentShader:$6.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:$6.cube_vert,fragmentShader:$6.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:$6.equirect_vert,fragmentShader:$6.equirect_frag},distance:{uniforms:b6([h8.common,h8.displacementmap,{referencePosition:{value:new u},nearDistance:{value:1},farDistance:{value:1000}}]),vertexShader:$6.distance_vert,fragmentShader:$6.distance_frag},shadow:{uniforms:b6([h8.lights,h8.fog,{color:{value:new r8(0)},opacity:{value:1}}]),vertexShader:$6.shadow_vert,fragmentShader:$6.shadow_frag}};E7.physical={uniforms:b6([E7.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new i8},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new i8},clearcoatNormalScale:{value:new L8(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new i8},diffuseRoughness:{value:0},diffuseRoughnessMap:{value:null},diffuseRoughnessMapTransform:{value:new i8},dispersion:{value:0},retroreflectivity:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new i8},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new i8},sheen:{value:0},sheenColor:{value:new r8(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new i8},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new i8},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new i8},transmissionSamplerSize:{value:new L8},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new i8},attenuationDistance:{value:0},attenuationColor:{value:new r8(0)},specularColor:{value:new r8(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new i8},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new i8},anisotropyVector:{value:new L8},anisotropyMap:{value:null},anisotropyMapTransform:{value:new i8}}]),vertexShader:$6.meshphysical_vert,fragmentShader:$6.meshphysical_frag};var j5={r:0,b:0,g:0},ZU=new G6,_Z=new i8;_Z.set(-1,0,0,0,1,0,0,0,1);function WU(J,Q,$,Z,W,q){let K=new r8(0),H=W===!0?0:1,U,Y,X=null,G=0,N=null;function F(_){let V=_.isScene===!0?_.background:null;if(V&&V.isTexture){let B=_.backgroundBlurriness>0;V=Q.get(V,B)}return V}function M(_){let V=!1,B=F(_);if(B===null)E(K,H);else if(B&&B.isColor)E(B,1),V=!0;let w=J.xr.getEnvironmentBlendMode();if(w==="additive")$.buffers.color.setClear(0,0,0,1,q);else if(w==="alpha-blend")$.buffers.color.setClear(0,0,0,0,q);if(J.autoClear||V)$.buffers.depth.setTest(!0),$.buffers.depth.setMask(!0),$.buffers.color.setMask(!0),J.clear(J.autoClearColor,J.autoClearDepth,J.autoClearStencil)}function L(_,V){let B=F(V);if(B&&B.isCubeTexture){if(Y===void 0)Y=new M6(new g7(1,1,1),new Z7({name:"BackgroundCubeMaterial",uniforms:W9(E7.backgroundCube.uniforms),vertexShader:E7.backgroundCube.vertexShader,fragmentShader:E7.backgroundCube.fragmentShader,side:f6,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),Y.geometry.deleteAttribute("normal"),Y.geometry.deleteAttribute("uv"),Y.onBeforeRender=function(w,y,D){this.matrixWorld.copyPosition(D.matrixWorld)},Object.defineProperty(Y.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),Z.update(Y);if(Y.material.uniforms.envMap.value=B,Y.material.uniforms.backgroundBlurriness.value=V.backgroundBlurriness,Y.material.uniforms.backgroundIntensity.value=V.backgroundIntensity,Y.material.uniforms.backgroundRotation.value.setFromMatrix4(ZU.makeRotationFromEuler(V.backgroundRotation)).transpose(),B.isRenderTargetTexture===!1)Y.material.uniforms.backgroundRotation.value.premultiply(_Z);if(Y.material.toneMapped=K6.getTransfer(B.colorSpace)!==E6,X!==B||G!==B.version||N!==J.toneMapping)Y.material.needsUpdate=!0,X=B,G=B.version,N=J.toneMapping;Y.layers.enableAll(),_.unshift(Y,Y.geometry,Y.material,0,0,null)}else if(B&&B.isTexture){if(U===void 0)U=new M6(new Z9(2,2),new Z7({name:"BackgroundMaterial",uniforms:W9(E7.background.uniforms),vertexShader:E7.background.vertexShader,fragmentShader:E7.background.fragmentShader,side:w9,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),U.geometry.deleteAttribute("normal"),Object.defineProperty(U.material,"map",{get:function(){return this.uniforms.t2D.value}}),Z.update(U);if(U.material.uniforms.t2D.value=B,U.material.uniforms.backgroundIntensity.value=V.backgroundIntensity,U.material.toneMapped=K6.getTransfer(B.colorSpace)!==E6,B.matrixAutoUpdate===!0)B.updateMatrix();if(U.material.uniforms.uvTransform.value.copy(B.matrix),X!==B||G!==B.version||N!==J.toneMapping)U.material.needsUpdate=!0,X=B,G=B.version,N=J.toneMapping;U.layers.enableAll(),_.unshift(U,U.geometry,U.material,0,0,null)}}function E(_,V){_.getRGB(j5,SJ(J)),$.buffers.color.setClear(j5.r,j5.g,j5.b,V,q)}function O(){if(Y!==void 0)Y.geometry.dispose(),Y.material.dispose(),Y=void 0;if(U!==void 0)U.geometry.dispose(),U.material.dispose(),U=void 0}return{getClearColor:function(){return K},setClearColor:function(_,V=1){K.set(_),H=V,E(K,H)},getClearAlpha:function(){return H},setClearAlpha:function(_){H=_,E(K,H)},render:M,addToRenderList:L,dispose:O}}function qU(J,Q){let $=J.getParameter(J.MAX_VERTEX_ATTRIBS),Z={},W=N(null),q=W,K=!1;function H(v,J8,E8,T,H8){let e=!1,S=G(v,T,E8,J8);if(q!==S)q=S,Y(q.object);if(e=F(v,T,E8,H8),e)M(v,T,E8,H8);if(H8!==null)Q.update(H8,J.ELEMENT_ARRAY_BUFFER);if(e||K){if(K=!1,B(v,J8,E8,T),H8!==null)J.bindBuffer(J.ELEMENT_ARRAY_BUFFER,Q.get(H8).buffer)}}function U(){return J.createVertexArray()}function Y(v){return J.bindVertexArray(v)}function X(v){return J.deleteVertexArray(v)}function G(v,J8,E8,T){let H8=T.wireframe===!0,e=Z[J8.id];if(e===void 0)e={},Z[J8.id]=e;let S=v.isInstancedMesh===!0?v.id:0,B8=e[S];if(B8===void 0)B8={},e[S]=B8;let i=B8[E8.id];if(i===void 0)i={},B8[E8.id]=i;let X8=i[H8];if(X8===void 0)X8=N(U()),i[H8]=X8;return X8}function N(v){let J8=[],E8=[],T=[];for(let H8=0;H8<$;H8++)J8[H8]=0,E8[H8]=0,T[H8]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:J8,enabledAttributes:E8,attributeDivisors:T,object:v,attributes:{},index:null}}function F(v,J8,E8,T){let H8=q.attributes,e=J8.attributes,S=0,B8=E8.getAttributes();for(let i in B8)if(B8[i].location>=0){let V8=H8[i],v8=e[i];if(v8===void 0){if(i==="instanceMatrix"&&v.instanceMatrix)v8=v.instanceMatrix;if(i==="instanceColor"&&v.instanceColor)v8=v.instanceColor}if(V8===void 0)return!0;if(V8.attribute!==v8)return!0;if(v8&&V8.data!==v8.data)return!0;S++}if(q.attributesNum!==S)return!0;if(q.index!==T)return!0;return!1}function M(v,J8,E8,T){let H8={},e=J8.attributes,S=0,B8=E8.getAttributes();for(let i in B8)if(B8[i].location>=0){let V8=e[i];if(V8===void 0){if(i==="instanceMatrix"&&v.instanceMatrix)V8=v.instanceMatrix;if(i==="instanceColor"&&v.instanceColor)V8=v.instanceColor}let v8={};if(v8.attribute=V8,V8&&V8.data)v8.data=V8.data;H8[i]=v8,S++}q.attributes=H8,q.attributesNum=S,q.index=T}function L(){let v=q.newAttributes;for(let J8=0,E8=v.length;J8<E8;J8++)v[J8]=0}function E(v){O(v,0)}function O(v,J8){let{newAttributes:E8,enabledAttributes:T,attributeDivisors:H8}=q;if(E8[v]=1,T[v]===0)J.enableVertexAttribArray(v),T[v]=1;if(H8[v]!==J8)J.vertexAttribDivisor(v,J8),H8[v]=J8}function _(){let{newAttributes:v,enabledAttributes:J8}=q;for(let E8=0,T=J8.length;E8<T;E8++)if(J8[E8]!==v[E8])J.disableVertexAttribArray(E8),J8[E8]=0}function V(v,J8,E8,T,H8,e,S){if(S===!0)J.vertexAttribIPointer(v,J8,E8,H8,e);else J.vertexAttribPointer(v,J8,E8,T,H8,e)}function B(v,J8,E8,T){L();let H8=T.attributes,e=E8.getAttributes(),S=J8.defaultAttributeValues;for(let B8 in e){let i=e[B8];if(i.location>=0){let X8=H8[B8];if(X8===void 0){if(B8==="instanceMatrix"&&v.instanceMatrix)X8=v.instanceMatrix;if(B8==="instanceColor"&&v.instanceColor)X8=v.instanceColor}if(X8!==void 0){let{normalized:V8,itemSize:v8}=X8,U8=Q.get(X8);if(U8===void 0)continue;let{buffer:M8,type:b8,bytesPerElement:n}=U8,d=b8===J.INT||b8===J.UNSIGNED_INT||X8.gpuType===_1;if(X8.isInterleavedBufferAttribute){let P=X8.data,C=P.isInterleavedBuffer===!0?P.stride:P.itemSize,g=X8.offset;if(P.isInstancedInterleavedBuffer||P.isInstancedBufferAttribute){for(let K8=0;K8<i.locationSize;K8++)O(i.location+K8,P.meshPerAttribute);if(v.isInstancedMesh!==!0&&T._maxInstanceCount===void 0)T._maxInstanceCount=P.meshPerAttribute*P.count}else for(let K8=0;K8<i.locationSize;K8++)E(i.location+K8);J.bindBuffer(J.ARRAY_BUFFER,M8);for(let K8=0;K8<i.locationSize;K8++)V(i.location+K8,v8/i.locationSize,b8,V8,C*n,(g+v8/i.locationSize*K8)*n,d)}else{if(X8.isInstancedBufferAttribute){for(let P=0;P<i.locationSize;P++)O(i.location+P,X8.meshPerAttribute);if(v.isInstancedMesh!==!0&&T._maxInstanceCount===void 0)T._maxInstanceCount=X8.meshPerAttribute*X8.count}else for(let P=0;P<i.locationSize;P++)E(i.location+P);J.bindBuffer(J.ARRAY_BUFFER,M8);for(let P=0;P<i.locationSize;P++)V(i.location+P,v8/i.locationSize,b8,V8,v8*n,v8/i.locationSize*P*n,d)}}else if(S!==void 0){let V8=S[B8];if(V8!==void 0)switch(V8.length){case 2:J.vertexAttrib2fv(i.location,V8);break;case 3:J.vertexAttrib3fv(i.location,V8);break;case 4:J.vertexAttrib4fv(i.location,V8);break;default:J.vertexAttrib1fv(i.location,V8)}}}}_()}function w(){m();for(let v in Z){let J8=Z[v];for(let E8 in J8){let T=J8[E8];for(let H8 in T){let e=T[H8];for(let S in e)X(e[S].object),delete e[S];delete T[H8]}}delete Z[v]}}function y(v){if(Z[v.id]===void 0)return;let J8=Z[v.id];for(let E8 in J8){let T=J8[E8];for(let H8 in T){let e=T[H8];for(let S in e)X(e[S].object),delete e[S];delete T[H8]}}delete Z[v.id]}function D(v){for(let J8 in Z){let E8=Z[J8];for(let T in E8){let H8=E8[T];if(H8[v.id]===void 0)continue;let e=H8[v.id];for(let S in e)X(e[S].object),delete e[S];delete H8[v.id]}}}function z(v){for(let J8 in Z){let E8=Z[J8],T=v.isInstancedMesh===!0?v.id:0,H8=E8[T];if(H8===void 0)continue;for(let e in H8){let S=H8[e];for(let B8 in S)X(S[B8].object),delete S[B8];delete H8[e]}if(delete E8[T],Object.keys(E8).length===0)delete Z[J8]}}function m(){if(t(),K=!0,q===W)return;q=W,Y(q.object)}function t(){W.geometry=null,W.program=null,W.wireframe=!1}return{setup:H,reset:m,resetDefaultState:t,dispose:w,releaseStatesOfGeometry:y,releaseStatesOfObject:z,releaseStatesOfProgram:D,initAttributes:L,enableAttribute:E,disableUnusedAttributes:_}}function KU(J,Q,$){let Z;function W(U){Z=U}function q(U,Y){J.drawArrays(Z,U,Y),$.update(Y,Z,1)}function K(U,Y,X){if(X===0)return;J.drawArraysInstanced(Z,U,Y,X),$.update(Y,Z,X)}function H(U,Y,X){if(X===0)return;Q.get("WEBGL_multi_draw").multiDrawArraysWEBGL(Z,U,0,Y,0,X);let N=0;for(let F=0;F<X;F++)N+=Y[F];$.update(N,Z,1)}this.setMode=W,this.render=q,this.renderInstances=K,this.renderMultiDraw=H}function HU(J,Q,$,Z){let W;function q(){if(W!==void 0)return W;if(Q.has("EXT_texture_filter_anisotropic")===!0){let D=Q.get("EXT_texture_filter_anisotropic");W=J.getParameter(D.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else W=0;return W}function K(D){if(D!==Q7&&Z.convert(D)!==J.getParameter(J.IMPLEMENTATION_COLOR_READ_FORMAT))return!1;return!0}function H(D){let z=D===G7&&(Q.has("EXT_color_buffer_half_float")||Q.has("EXT_color_buffer_float"));if(D!==J7&&D!==I7&&!z&&Z.convert(D)!==J.getParameter(J.IMPLEMENTATION_COLOR_READ_TYPE))return!1;return!0}function U(D){if(D==="highp"){if(J.getShaderPrecisionFormat(J.VERTEX_SHADER,J.HIGH_FLOAT).precision>0&&J.getShaderPrecisionFormat(J.FRAGMENT_SHADER,J.HIGH_FLOAT).precision>0)return"highp";D="mediump"}if(D==="mediump"){if(J.getShaderPrecisionFormat(J.VERTEX_SHADER,J.MEDIUM_FLOAT).precision>0&&J.getShaderPrecisionFormat(J.FRAGMENT_SHADER,J.MEDIUM_FLOAT).precision>0)return"mediump"}return"lowp"}let Y=$.precision!==void 0?$.precision:"highp",X=U(Y);if(X!==Y)t8("WebGLRenderer:",Y,"not supported, using",X,"instead."),Y=X;let G=$.reversedDepthBuffer===!0&&Q.has("EXT_clip_control"),N=$.logarithmicDepthBuffer===!0&&G===!1;if($.reversedDepthBuffer===!0&&G===!1)t8("WebGLRenderer: Unable to use reversed depth buffer due to missing EXT_clip_control extension. Fallback to default depth buffer.");if($.logarithmicDepthBuffer===!0&&G===!0)t8("WebGLRenderer: Logarithmic depth buffer is ignored when reversed depth buffer is enabled.");let F=J.getParameter(J.MAX_TEXTURE_IMAGE_UNITS),M=J.getParameter(J.MAX_VERTEX_TEXTURE_IMAGE_UNITS),L=J.getParameter(J.MAX_TEXTURE_SIZE),E=J.getParameter(J.MAX_CUBE_MAP_TEXTURE_SIZE),O=J.getParameter(J.MAX_VERTEX_ATTRIBS),_=J.getParameter(J.MAX_VERTEX_UNIFORM_VECTORS),V=J.getParameter(J.MAX_VARYING_VECTORS),B=J.getParameter(J.MAX_FRAGMENT_UNIFORM_VECTORS),w=J.getParameter(J.MAX_SAMPLES),y=J.getParameter(J.SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:q,getMaxPrecision:U,textureFormatReadable:K,textureTypeReadable:H,precision:Y,logarithmicDepthBuffer:N,reversedDepthBuffer:G,maxTextures:F,maxVertexTextures:M,maxTextureSize:L,maxCubemapSize:E,maxAttributes:O,maxVertexUniforms:_,maxVaryings:V,maxFragmentUniforms:B,maxSamples:w,samples:y}}function UU(J){let Q=this,$=null,Z=0,W=!1,q=!1,K=new q7,H=new i8,U={value:null,needsUpdate:!1};this.uniform=U,this.numPlanes=0,this.numIntersection=0,this.init=function(G,N){let F=G.length!==0||N||Z!==0||W;return W=N,Z=G.length,F},this.beginShadows=function(){q=!0,X(null)},this.endShadows=function(){q=!1},this.setGlobalState=function(G,N){$=X(G,N,0)},this.setState=function(G,N,F){let{clippingPlanes:M,clipIntersection:L,clipShadows:E}=G,O=J.get(G);if(!W||M===null||M.length===0||q&&!E)if(q)X(null);else Y();else{let _=q?0:Z,V=_*4,B=O.clippingState||null;U.value=B,B=X(M,N,V,F);for(let w=0;w!==V;++w)B[w]=$[w];O.clippingState=B,this.numIntersection=L?this.numPlanes:0,this.numPlanes+=_}};function Y(){if(U.value!==$)U.value=$,U.needsUpdate=Z>0;Q.numPlanes=Z,Q.numIntersection=0}function X(G,N,F,M){let L=G!==null?G.length:0,E=null;if(L!==0){if(E=U.value,M!==!0||E===null){let O=F+L*4,_=N.matrixWorldInverse;if(H.getNormalMatrix(_),E===null||E.length<O)E=new Float32Array(O);for(let V=0,B=F;V!==L;++V,B+=4)K.copy(G[V]).applyMatrix4(_,H),K.normal.toArray(E,B),E[B+3]=K.constant}U.value=E,U.needsUpdate=!0}return Q.numPlanes=L,Q.numIntersection=0,E}}class v5 extends c6{constructor(J=1,Q={}){super(J,J,Q);this.isWebGLCubeRenderTarget=!0;let $={width:J,height:J,depth:1},Z=[$,$,$,$,$,$];this.texture=new D5(Z),this._setTextureOptions(Q),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(J,Q){this.texture.type=Q.type,this.texture.colorSpace=Q.colorSpace,this.texture.generateMipmaps=Q.generateMipmaps,this.texture.minFilter=Q.minFilter,this.texture.magFilter=Q.magFilter;let $={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},Z=new g7(5,5,5),W=new Z7({name:"CubemapFromEquirect",uniforms:W9($.uniforms),vertexShader:$.vertexShader,fragmentShader:$.fragmentShader,side:f6,blending:a7});W.uniforms.tEquirect.value=Q;let q=new M6(Z,W),K=Q.minFilter;if(Q.minFilter===v7)Q.minFilter=u6;return new D0(1,10,this).update(J,q),Q.minFilter=K,q.geometry.dispose(),q.material.dispose(),this}clear(J,Q=!0,$=!0,Z=!0){let W=J.getRenderTarget();for(let q=0;q<6;q++)J.setRenderTarget(this,q),J.clear(Q,$,Z);J.setRenderTarget(W)}}var WZ=256,YU=3,XU=20,CZ=256,PZ=16,GU=3,NU=new u,EU=new r8;class p9{constructor(J){this._renderer=J,this._cubeSize=0,this._sourceTarget=null,this._cubeCamera=new D0(1,10,null),this._boxMesh=new M6(new g7(5,5,5),null),this._cubemapMaterial=null,this._equirectMaterial=null,this._blurMaterial=null,this._ggxMaterial=null,this._integrationMaterial=null}fromScene(J,Q=0,$=0.1,Z=100,W={}){let{size:q=256,position:K=NU}=W,H=this._renderer;this._setSize(q);let U=this._allocateTarget(),Y=this._getSourceTarget(!0);if(Q>0)Y.texture.mipmapsAutoUpdate=!1;let{autoClear:X,autoClearColor:G,autoClearDepth:N,autoClearStencil:F}=H,M=J.background;if(H.autoClear=!0,H.autoClearColor=!0,H.autoClearDepth=!0,H.autoClearStencil=!0,M===null)J.background=H.getClearColor(EU);let L=new D0($,Z,Y);if(L.position.copy(K),L.update(H,J),H.autoClear=X,H.autoClearColor=G,H.autoClearDepth=N,H.autoClearStencil=F,J.background=M,Q>0)Y.texture.mipmapsAutoUpdate=!0,this._blur(U,Q);return this._applyPMREM(U),U}fromEquirectangular(J,Q=null){return this._fromTexture(J,Q)}fromCubemap(J,Q=null){return this._fromTexture(J,Q)}compileCubemapShader(){if(this._cubemapMaterial===null)this._cubemapMaterial=HZ(),this._compileMaterial(this._cubemapMaterial)}compileEquirectangularShader(){if(this._equirectMaterial===null)this._equirectMaterial=KZ(),this._compileMaterial(this._equirectMaterial)}dispose(){if(this._sourceTarget!==null)this._sourceTarget.dispose();if(this._cubemapMaterial!==null)this._cubemapMaterial.dispose();if(this._equirectMaterial!==null)this._equirectMaterial.dispose();if(this._blurMaterial!==null)this._blurMaterial.dispose();if(this._ggxMaterial!==null)this._ggxMaterial.dispose();if(this._integrationMaterial!==null)this._integrationMaterial.dispose();this._boxMesh.geometry.dispose()}static lodToRoughness(J,Q){return Q>0?1-Math.sqrt(1-J/Q):0}_setSize(J){this._cubeSize=Math.max(WZ,MJ(J))}_fromTexture(J,Q){if(J.mapping===U0||J.mapping===S9)this._setSize(J.image.length===0?WZ:J.image[0].width||J.image[0].image.width);else this._setSize(J.image.width/4);let $=Q||this._allocateTarget();return this._textureToCubemap(J),this._applyPMREM($),$}_allocateTarget(){let J=this._cubeSize,Q=qZ(J,!1,!1),$=Math.log2(J)-YU;for(let Z=0;Z<=$;Z++)Q.texture.mipmaps.push({width:J>>Z,height:J>>Z});return Q.texture.name="PMREM",Q.texture.isPMREMTexture=!0,Q}_getSourceTarget(J=!1){let Q=this._cubeSize,$=this._sourceTarget;if($===null||$.width!==Q||J&&$.depthBuffer===!1){if($!==null)$.dispose();this._sourceTarget=qZ(Q,!0,J)}return this._sourceTarget}_compileMaterial(J){this._boxMesh.material=J,this._renderer.compile(this._boxMesh,this._cubeCamera.children[0])}_renderCube(J,Q,$){let Z=this._boxMesh,W=this._cubeCamera;Z.material=$,W.renderTarget=J,W.activeMipmapLevel=Q;let q=J.width>>Q;J.viewport.set(0,0,q,q),W.update(this._renderer,Z),J.viewport.set(0,0,J.width,J.height)}_textureToCubemap(J){let Q;if(J.mapping===U0||J.mapping===S9){if(this._cubemapMaterial===null)this._cubemapMaterial=HZ();Q=this._cubemapMaterial,Q.uniforms.flipEnvMap.value=J.isRenderTargetTexture===!1?-1:1}else{if(this._equirectMaterial===null)this._equirectMaterial=KZ();Q=this._equirectMaterial}Q.uniforms.envMap.value=J,this._renderCube(this._getSourceTarget(),0,Q)}_applyPMREM(J){if(this._ggxMaterial===null)this._ggxMaterial=FU(),this._integrationMaterial=DU();let Q=this._cubeSize,$=J.texture.mipmaps.length-1,Z=this._ggxMaterial.uniforms;Z.envMap.value=this._sourceTarget.texture;let W=this._integrationMaterial.uniforms;W.envMap.value=this._sourceTarget.texture,W.sourceLod.value=Math.log2(Q/PZ);for(let q=0;q<=$;q++){let K=p9.lodToRoughness(q,$);if(q>$-GU)W.roughness.value=K,this._renderCube(J,q,this._integrationMaterial);else{let H=K>0?Math.log2(Q)+0.5*Math.log2(6/(CZ*Math.pow(K,4)))+0.5:0;Z.roughness.value=K,Z.lodBias.value=H,this._renderCube(J,q,this._ggxMaterial)}}}_blur(J,Q){if(this._blurMaterial===null)this._blurMaterial=OU();let $=this._blurMaterial,Z=$.uniforms,W=this._sourceTarget;Z.sigma.value=Math.min(Q,Math.PI)/Math.SQRT2,Z.envMap.value=W.texture,this._renderCube(J,0,$),Z.envMap.value=J.texture,this._renderCube(W,0,$)}}function qZ(J,Q,$){return new v5(J,{minFilter:v7,generateMipmaps:Q,type:G7,colorSpace:YJ,depthBuffer:$})}function L0(J,Q,$){return new Z7({name:J,uniforms:Q,vertexShader:$6.cube_vert,fragmentShader:$,side:f6,blending:a7,depthTest:!1,depthWrite:!1})}function FU(){return L0("PMREMGGXConvolution",{envMap:{value:null},roughness:{value:0},lodBias:{value:0}},`

		#define GGX_SAMPLES ${CZ}u

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float roughness;
		uniform float lodBias;

		#include <common>

		// Van der Corput radical inverse
		float radicalInverse_VdC( uint bits ) {

			bits = ( bits << 16u ) | ( bits >> 16u );
			bits = ( ( bits & 0x55555555u ) << 1u ) | ( ( bits & 0xAAAAAAAAu ) >> 1u );
			bits = ( ( bits & 0x33333333u ) << 2u ) | ( ( bits & 0xCCCCCCCCu ) >> 2u );
			bits = ( ( bits & 0x0F0F0F0Fu ) << 4u ) | ( ( bits & 0xF0F0F0F0u ) >> 4u );
			bits = ( ( bits & 0x00FF00FFu ) << 8u ) | ( ( bits & 0xFF00FF00u ) >> 8u );
			return float( bits ) * 2.3283064365386963e-10; // / 0x100000000

		}

		// Hammersley sequence
		vec2 hammersley( uint i, uint N ) {

			return vec2( float( i ) / float( N ), radicalInverse_VdC( i ) );

		}

		void main() {

			vec3 N = normalize( vWorldDirection );

			// For very low roughness, just sample the environment directly
			if ( roughness < 0.001 ) {

				gl_FragColor = vec4( textureLod( envMap, N, 0.0 ).rgb, 1.0 );
				return;

			}

			float alpha = roughness * roughness;
			float alpha2 = alpha * alpha;

			// Tangent space basis for VNDF sampling
			vec3 up = abs( N.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
			vec3 tangent = normalize( cross( up, N ) );
			vec3 bitangent = cross( N, tangent );

			vec3 prefilteredColor = vec3( 0.0 );
			float totalWeight = 0.0;

			for ( uint i = 0u; i < GGX_SAMPLES; i ++ ) {

				vec2 Xi = hammersley( i, GGX_SAMPLES );

				// With V = N, sample the reflected direction directly.
				float invQ = 1.0 / ( 1.0 - Xi.x + alpha2 * Xi.x );
				float NdotL = ( 1.0 - Xi.x - alpha2 * Xi.x ) * invQ;

				if ( NdotL > 0.0 ) {

					float phi = 2.0 * PI * Xi.y;
					float sinTheta = 2.0 * alpha * sqrt( Xi.x * ( 1.0 - Xi.x ) ) * invQ;
					vec3 L = N * NdotL + ( tangent * cos( phi ) + bitangent * sin( phi ) ) * sinTheta;

					// Match the source mip to the sample's solid angle. The terms
					// independent of the sample are precomputed in lodBias.
					float d = alpha2 * invQ;
					float lod = max( log2( d ) + lodBias, 0.0 );

					// Weight by NdotL for the split-sum approximation
					prefilteredColor += textureLod( envMap, L, lod ).rgb * NdotL;
					totalWeight += NdotL;

				}

			}

			gl_FragColor = vec4( prefilteredColor / totalWeight, 1.0 );

		}
	`)}function DU(){return L0("PMREMGGXIntegration",{envMap:{value:null},roughness:{value:0},sourceLod:{value:0},sourceSize:{value:PZ}},`

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float roughness;
		uniform float sourceLod;
		uniform int sourceSize;

		void main() {

			vec3 N = normalize( vWorldDirection );

			float alpha = roughness * roughness;
			float alpha2 = alpha * alpha;

			float texelSize = 2.0 / float( sourceSize );

			vec3 prefilteredColor = vec3( 0.0 );
			float totalWeight = 0.0;

			// Pair opposite texels: only the one in N's hemisphere contributes.
			for ( int face = 0; face < 3; face ++ ) {

				for ( int y = 0; y < sourceSize; y ++ ) {

					for ( int x = 0; x < sourceSize; x ++ ) {

						vec2 uv = ( vec2( x, y ) + 0.5 ) * texelSize - 1.0;
						vec3 texelDirection = face == 0 ? vec3( 1.0, uv ) : ( face == 1 ? vec3( uv.x, 1.0, uv.y ) : vec3( uv, 1.0 ) );

						float invDistance = inversesqrt( 1.0 + dot( uv, uv ) );
						float NdotL = dot( N, texelDirection );
						texelDirection *= NdotL < 0.0 ? - 1.0 : 1.0;
						NdotL = abs( NdotL ) * invDistance;

						// With V = N, NdotH squared is ( 1 + NdotL ) / 2. Common factors
						// in the GGX distribution and texel solid angle cancel when normalized.
						float d = 1.0 + alpha2 + ( alpha2 - 1.0 ) * NdotL;
						float weight = NdotL * invDistance * invDistance * invDistance / ( d * d );

						prefilteredColor += textureLod( envMap, texelDirection, sourceLod ).rgb * weight;
						totalWeight += weight;

					}

				}

			}

			gl_FragColor = vec4( prefilteredColor / totalWeight, 1.0 );

		}
	`)}function OU(){return L0("PMREMSphericalGaussianBlur",{envMap:{value:null},sigma:{value:0}},`

		#define SAMPLES ${XU}
		#define GOLDEN_ANGLE 2.39996322973

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float sigma;

		#include <common>

		void main() {

			vec3 outputDirection = normalize( vWorldDirection );

			vec3 up = abs( outputDirection.z ) < 0.999 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 1.0, 0.0, 0.0 );
			vec3 tangent = normalize( cross( up, outputDirection ) );
			vec3 bitangent = cross( outputDirection, tangent );

			// Truncate the kernel at three standard deviations or at the antipode.
			float thetaMax = min( 3.0 * sigma, PI );
			float truncation = 1.0 - exp( - 0.5 * thetaMax * thetaMax / ( sigma * sigma ) );

			vec3 accumColor = vec3( 0.0 );
			float accumWeight = 0.0;

			for ( int i = 0; i < SAMPLES; i ++ ) {

				// Stratified inverse-CDF sampling of the Gaussian, placed on a golden-angle spiral.
				float stratum = ( float( i ) + 0.5 ) / float( SAMPLES );
				float theta = sigma * sqrt( - 2.0 * log( 1.0 - stratum * truncation ) );
				float phi = float( i ) * GOLDEN_ANGLE;

				vec3 offset = cos( phi ) * tangent + sin( phi ) * bitangent;
				vec3 sampleDirection = cos( theta ) * outputDirection + sin( theta ) * offset;

				// Correct the planar sample density to solid angle.
				float weight = sin( theta ) / theta;

				accumColor += weight * textureLod( envMap, sampleDirection, 0.0 ).rgb;
				accumWeight += weight;

			}

			gl_FragColor = vec4( accumColor / accumWeight, 1.0 );

		}
	`)}function KZ(){return L0("PMREMEquirectangularToCubemap",{envMap:{value:null}},`

		varying vec3 vWorldDirection;

		uniform sampler2D envMap;

		#include <common>

		void main() {

			// Average four subpixel samples to preserve small, bright features.
			vec3 direction = normalize( vWorldDirection );
			vec3 dx = dFdx( direction ) * 0.25;
			vec3 dy = dFdy( direction ) * 0.25;

			vec3 color = textureLod( envMap, equirectUv( normalize( direction - dx - dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction + dx - dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction - dx + dy ) ), 0.0 ).rgb;
			color += textureLod( envMap, equirectUv( normalize( direction + dx + dy ) ), 0.0 ).rgb;
			gl_FragColor = vec4( color * 0.25, 1.0 );

		}
	`)}function HZ(){return L0("PMREMCubemapToCubemap",{envMap:{value:null},flipEnvMap:{value:-1}},`

		varying vec3 vWorldDirection;

		uniform samplerCube envMap;
		uniform float flipEnvMap;

		void main() {

			gl_FragColor = vec4( textureCube( envMap, vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) ).rgb, 1.0 );

		}
	`)}function RU(J){let Q=new WeakMap,$=new WeakMap,Z=null;function W(N,F=!1){if(N===null||N===void 0)return null;if(F)return K(N);return q(N)}function q(N){if(N&&N.isTexture){let F=N.mapping;if(F===r0||F===t0)if(Q.has(N)){let M=Q.get(N).texture;return H(M,N.mapping)}else{let M=N.image;if(M&&M.height>0){let L=new v5(M.height);return L.fromEquirectangularTexture(J,N),Q.set(N,L),N.addEventListener("dispose",Y),H(L.texture,N.mapping)}else return null}}return N}function K(N){if(N&&N.isTexture&&N.isPMREMTexture!==!0){let F=N.mapping,M=F===r0||F===t0,L=F===U0||F===S9;if(M||L){let E=$.get(N),O=E!==void 0?E.texture.pmremVersion:0;if(N.isRenderTargetTexture&&N.pmremVersion!==O){if(Z===null)Z=new p9(J);return E=M?Z.fromEquirectangular(N,E):Z.fromCubemap(N,E),E.texture.pmremVersion=N.pmremVersion,$.set(N,E),E.texture}else if(E!==void 0)return E.texture;else{let _=N.image;if(M&&_&&_.height>0||L&&_&&U(_)){if(Z===null)Z=new p9(J);return E=M?Z.fromEquirectangular(N):Z.fromCubemap(N),E.texture.pmremVersion=N.pmremVersion,$.set(N,E),N.addEventListener("dispose",X),E.texture}else return null}}}return N}function H(N,F){if(F===r0)N.mapping=U0;else if(F===t0)N.mapping=S9;return N}function U(N){let F=0,M=6;for(let L=0;L<M;L++)if(N[L]!==void 0)F++;return F===M}function Y(N){let F=N.target;F.removeEventListener("dispose",Y);let M=Q.get(F);if(M!==void 0)Q.delete(F),M.dispose()}function X(N){let F=N.target;F.removeEventListener("dispose",X);let M=$.get(F);if(M!==void 0)$.delete(F),M.dispose()}function G(){if(Q=new WeakMap,$=new WeakMap,Z!==null)Z.dispose(),Z=null}return{get:W,dispose:G}}function MU(J){let Q={};function $(Z){if(Q[Z]!==void 0)return Q[Z];let W=J.getExtension(Z);return Q[Z]=W,W}return{has:function(Z){return $(Z)!==null},init:function(){$("EXT_color_buffer_float"),$("WEBGL_clip_cull_distance"),$("OES_texture_float_linear"),$("EXT_color_buffer_half_float"),$("WEBGL_multisampled_render_to_texture"),$("WEBGL_render_shared_exponent")},get:function(Z){let W=$(Z);if(W===null)s7("WebGLRenderer: "+Z+" extension not supported.");return W}}}function kU(J,Q,$,Z){let W={},q=new WeakMap,K=new FinalizationRegistry((M)=>delete W[M]);function H(M){U(M.target)}function U(M){if(M.index!==null)Q.remove(M.index);for(let E in M.attributes)Q.remove(M.attributes[E]);M.removeEventListener("dispose",H),delete W[M.id],K.unregister(M);let L=q.get(M);if(L)Q.remove(L),q.delete(M);if(Z.releaseStatesOfGeometry(M),M.isInstancedBufferGeometry===!0)delete M._maxInstanceCount;$.memory.geometries--}function Y(M,L){if(W[L.id]!==void 0)return L;return L.addEventListener("dispose",H),W[L.id]=new WeakRef(L),K.register(L,L.id,L),$.memory.geometries++,L}function X(M){let L=M.attributes;for(let E in L)Q.update(L[E],J.ARRAY_BUFFER)}function G(M){let L=M.index,E=M.attributes.position,O=0;if(E===void 0)return;let _=L!==null?L.array.length:E.array.length/3-1,B=new(E.count>=65535?N5:G5)(Math.ceil(_/3)*6,1),w=B.array;if(L!==null){let D=L.array;O=L.version;for(let z=0,m=0;z<_;z+=3){let t=D[z+0],v=D[z+1],J8=D[z+2];w[m++]=t,w[m++]=v,w[m++]=v,w[m++]=J8,w[m++]=J8,w[m++]=t}}else{O=E.version;for(let D=0,z=0;D<_;D+=3){let m=D+0,t=D+1,v=D+2;w[z++]=m,w[z++]=t,w[z++]=t,w[z++]=v,w[z++]=v,w[z++]=m}}B.version=O;let y=q.get(M);if(y)Q.remove(y);q.set(M,B)}function N(M){let L=q.get(M);if(L){let E=M.index;if(E!==null){if(L.version<E.version)G(M)}}else G(M);return q.get(M)}function F(){for(let M in W){let L=W[M].deref();if(L!==void 0)U(L)}}return{get:Y,update:X,getWireframeAttribute:N,dispose:F}}function LU(J,Q,$){let Z;function W(G){Z=G}let q,K;function H(G){q=G.type,K=G.bytesPerElement}function U(G,N){J.drawElements(Z,N,q,G*K),$.update(N,Z,1)}function Y(G,N,F){if(F===0)return;J.drawElementsInstanced(Z,N,q,G*K,F),$.update(N,Z,F)}function X(G,N,F){if(F===0)return;Q.get("WEBGL_multi_draw").multiDrawElementsWEBGL(Z,N,0,q,G,0,F);let L=0;for(let E=0;E<F;E++)L+=N[E];$.update(L,Z,1)}this.setMode=W,this.setIndex=H,this.render=U,this.renderInstances=Y,this.renderMultiDraw=X}function BU(J){let Q={geometries:0,textures:0},$={frame:0,calls:0,triangles:0,points:0,lines:0};function Z(q,K,H){switch($.calls++,K){case J.TRIANGLES:$.triangles+=H*(q/3);break;case J.LINES:$.lines+=H*(q/2);break;case J.LINE_STRIP:$.lines+=H*(q-1);break;case J.LINE_LOOP:$.lines+=H*q;break;case J.POINTS:$.points+=H*q;break;default:e8("WebGLInfo: Unknown draw mode:",K);break}}function W(){$.calls=0,$.triangles=0,$.points=0,$.lines=0}return{memory:Q,render:$,programs:null,autoReset:!0,reset:W,update:Z}}function zU(J,Q,$){let Z=new WeakMap,W=new R6;function q(K,H,U){let Y=K.morphTargetInfluences,X=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,G=X!==void 0?X.length:0,N=Z.get(H);if(N===void 0||N.count!==G){let m=function(){D.dispose(),Z.delete(H),H.removeEventListener("dispose",m)};if(N!==void 0)N.texture.dispose();let F=H.morphAttributes.position!==void 0,M=H.morphAttributes.normal!==void 0,L=H.morphAttributes.color!==void 0,E=H.morphAttributes.position||[],O=H.morphAttributes.normal||[],_=H.morphAttributes.color||[],V=0;if(F===!0)V=1;if(M===!0)V=2;if(L===!0)V=3;let B=H.attributes.position.count*V,w=1;if(B>Q.maxTextureSize)w=Math.ceil(B/Q.maxTextureSize),B=Q.maxTextureSize;let y=new Float32Array(B*w*4*G),D=new Y5(y,B,w,G);D.type=I7,D.needsUpdate=!0;let z=V*4;for(let t=0;t<G;t++){let v=E[t],J8=O[t],E8=_[t],T=B*w*4*t;for(let H8=0;H8<v.count;H8++){let e=H8*z;if(F===!0)W.fromBufferAttribute(v,H8),y[T+e+0]=W.x,y[T+e+1]=W.y,y[T+e+2]=W.z,y[T+e+3]=0;if(M===!0)W.fromBufferAttribute(J8,H8),y[T+e+4]=W.x,y[T+e+5]=W.y,y[T+e+6]=W.z,y[T+e+7]=0;if(L===!0)W.fromBufferAttribute(E8,H8),y[T+e+8]=W.x,y[T+e+9]=W.y,y[T+e+10]=W.z,y[T+e+11]=E8.itemSize===4?W.w:1}}N={count:G,texture:D,size:new L8(B,w)},Z.set(H,N),H.addEventListener("dispose",m)}if(K.isInstancedMesh===!0&&K.morphTexture!==null)U.getUniforms().setValue(J,"morphTexture",K.morphTexture,$);else{let F=0;for(let L=0;L<Y.length;L++)F+=Y[L];let M=H.morphTargetsRelative?1:1-F;U.getUniforms().setValue(J,"morphTargetBaseInfluence",M),U.getUniforms().setValue(J,"morphTargetInfluences",Y)}U.getUniforms().setValue(J,"morphTargetsTexture",N.texture,$),U.getUniforms().setValue(J,"morphTargetsTextureSize",N.size)}return{update:q}}function VU(J,Q,$,Z,W){let q=new WeakMap;function K(Y){let X=W.render.frame,G=Y.geometry,N=Q.get(Y,G);if(q.get(N)!==X)Q.update(N),q.set(N,X);if(Y.isInstancedMesh){if(Y.hasEventListener("dispose",U)===!1)Y.addEventListener("dispose",U);if(q.get(Y)!==X){if($.update(Y.instanceMatrix,J.ARRAY_BUFFER),Y.instanceColor!==null)$.update(Y.instanceColor,J.ARRAY_BUFFER);q.set(Y,X)}}if(Y.isSkinnedMesh){let F=Y.skeleton;if(q.get(F)!==X)F.update(),q.set(F,X)}return N}function H(){q=new WeakMap}function U(Y){let X=Y.target;if(X.removeEventListener("dispose",U),Z.releaseStatesOfObject(X),$.remove(X.instanceMatrix),X.instanceColor!==null)$.remove(X.instanceColor)}return{update:K,dispose:H}}var IU={[L1]:"LINEAR_TONE_MAPPING",[B1]:"REINHARD_TONE_MAPPING",[z1]:"CINEON_TONE_MAPPING",[H0]:"ACES_FILMIC_TONE_MAPPING",[I1]:"AGX_TONE_MAPPING",[A1]:"NEUTRAL_TONE_MAPPING",[V1]:"CUSTOM_TONE_MAPPING"};function AU(J,Q,$,Z,W,q){let K=new c6(Q,$,{type:J,depthBuffer:W,stencilBuffer:q,samples:Z?4:0,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,resolveDepthBuffer:!1,resolveStencilBuffer:!1}),H=null,U=null,Y=null,X=new $7;X.setAttribute("position",new T6([-1,3,0,-1,-1,0,3,-1,0],3)),X.setAttribute("uv",new T6([0,2,0,0,2,0],2));let G=new jJ({uniforms:{tDiffuse:{value:null}},vertexShader:`
			precision highp float;

			uniform mat4 modelViewMatrix;
			uniform mat4 projectionMatrix;

			attribute vec3 position;
			attribute vec2 uv;

			varying vec2 vUv;

			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}`,fragmentShader:`
			precision highp float;

			uniform sampler2D tDiffuse;

			varying vec2 vUv;

			#include <tonemapping_pars_fragment>
			#include <colorspace_pars_fragment>

			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );

				#ifdef LINEAR_TONE_MAPPING
					gl_FragColor.rgb = LinearToneMapping( gl_FragColor.rgb );
				#elif defined( REINHARD_TONE_MAPPING )
					gl_FragColor.rgb = ReinhardToneMapping( gl_FragColor.rgb );
				#elif defined( CINEON_TONE_MAPPING )
					gl_FragColor.rgb = CineonToneMapping( gl_FragColor.rgb );
				#elif defined( ACES_FILMIC_TONE_MAPPING )
					gl_FragColor.rgb = ACESFilmicToneMapping( gl_FragColor.rgb );
				#elif defined( AGX_TONE_MAPPING )
					gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );
				#elif defined( NEUTRAL_TONE_MAPPING )
					gl_FragColor.rgb = NeutralToneMapping( gl_FragColor.rgb );
				#elif defined( CUSTOM_TONE_MAPPING )
					gl_FragColor.rgb = CustomToneMapping( gl_FragColor.rgb );
				#endif

				#ifdef SRGB_TRANSFER
					gl_FragColor = sRGBTransferOETF( gl_FragColor );
				#endif
			}`,depthTest:!1,depthWrite:!1}),N=new M6(X,G),F=new T5(-1,1,1,-1,0,1),M=null,L=null,E=!1,O,_=null,V=[],B=!1;this.setSize=function(w,y){if(K.setSize(w,y),H!==null)H.setSize(w,y);if(U!==null)U.setSize(w,y);for(let D=0;D<V.length;D++){let z=V[D];if(z.setSize)z.setSize(w,y)}},this.setEffects=function(w){V=w,B=V.length>0&&V[0].isRenderPass===!0;let{width:y,height:D}=K;if(V.length>0&&H===null)H=new c6(y,D,{type:G7,depthBuffer:!1,stencilBuffer:!1}),U=new c6(y,D,{type:G7,depthBuffer:!1,stencilBuffer:!1});let z=W===!0&&V.some((m)=>m.needsDepthTexture===!0);if(z!==(K.depthTexture!==null)){if(z===!0&&Y===null){if(Y=new x7(y,D),q===!0)Y.format=b7,Y.type=r7}K.dispose(),K.depthTexture=z?Y:null,K.resolveDepthBuffer=z,K.storeMultisampledDepthBuffer=z}for(let m=0;m<V.length;m++){let t=V[m];if(t.setSize)t.setSize(y,D);if(z&&t.needsDepthTexture===!0&&t.setDepthTexture)t.setDepthTexture(Y)}},this.begin=function(w,y){if(E)return!1;if(w.toneMapping===X7&&V.length===0)return!1;if(_=y,y!==null){let{width:D,height:z}=y;if(K.width!==D||K.height!==z)this.setSize(D,z)}if(B===!1)w.setRenderTarget(K);return O=w.toneMapping,w.toneMapping=X7,!0},this.hasRenderPass=function(){return B},this.end=function(w,y){w.toneMapping=O,E=!0;let D=K,z=H;for(let m=0;m<V.length;m++){let t=V[m];if(t.enabled===!1)continue;if(t.render(w,z,D,y),t.needsSwap!==!1)D=z,z=z===H?U:H}if(M!==w.outputColorSpace||L!==w.toneMapping){if(M=w.outputColorSpace,L=w.toneMapping,G.defines={},K6.getTransfer(M)===E6)G.defines.SRGB_TRANSFER="";let m=IU[L];if(m)G.defines[m]="";G.needsUpdate=!0}G.uniforms.tDiffuse.value=D.texture,w.setRenderTarget(_),w.render(N,F),_=null,E=!1},this.isCompositing=function(){return E},this.dispose=function(){if(K.dispose(),H!==null)H.dispose();if(U!==null)U.dispose();X.dispose(),G.dispose()}}var wZ=new w6,TZ=new x7(1,1),SZ=new R5(1),jZ=new Y5,yZ=new zJ,vZ=new D5,UZ=[],YZ=[],XZ=new Float32Array(16),GZ=new Float32Array(9),NZ=new Float32Array(4);function m9(J,Q,$){let Z=J[0];if(Z<=0||Z>0)return J;let W=Q*$,q=UZ[W];if(q===void 0)q=new Float32Array(W),UZ[W]=q;if(Q!==0){Z.toArray(q,0);for(let K=1,H=0;K!==Q;++K)H+=$,J[K].toArray(q,H)}return q}function V6(J,Q){if(J.length!==Q.length)return!1;for(let $=0,Z=J.length;$<Z;$++)if(J[$]!==Q[$])return!1;return!0}function I6(J,Q){for(let $=0,Z=Q.length;$<Z;$++)J[$]=Q[$]}function f5(J,Q){let $=YZ[Q];if($===void 0)$=new Int32Array(Q),YZ[Q]=$;for(let Z=0;Z!==Q;++Z)$[Z]=J.allocateTextureUnit();return $}function _U(J,Q){let $=this.cache;if($[0]===Q)return;J.uniform1f(this.addr,Q),$[0]=Q}function CU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y)J.uniform2f(this.addr,Q.x,Q.y),$[0]=Q.x,$[1]=Q.y}else{if(V6($,Q))return;J.uniform2fv(this.addr,Q),I6($,Q)}}function PU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z)J.uniform3f(this.addr,Q.x,Q.y,Q.z),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z}else if(Q.r!==void 0){if($[0]!==Q.r||$[1]!==Q.g||$[2]!==Q.b)J.uniform3f(this.addr,Q.r,Q.g,Q.b),$[0]=Q.r,$[1]=Q.g,$[2]=Q.b}else{if(V6($,Q))return;J.uniform3fv(this.addr,Q),I6($,Q)}}function wU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z||$[3]!==Q.w)J.uniform4f(this.addr,Q.x,Q.y,Q.z,Q.w),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z,$[3]=Q.w}else{if(V6($,Q))return;J.uniform4fv(this.addr,Q),I6($,Q)}}function TU(J,Q){let $=this.cache,Z=Q.elements;if(Z===void 0){if(V6($,Q))return;J.uniformMatrix2fv(this.addr,!1,Q),I6($,Q)}else{if(V6($,Z))return;NZ.set(Z),J.uniformMatrix2fv(this.addr,!1,NZ),I6($,Z)}}function SU(J,Q){let $=this.cache,Z=Q.elements;if(Z===void 0){if(V6($,Q))return;J.uniformMatrix3fv(this.addr,!1,Q),I6($,Q)}else{if(V6($,Z))return;GZ.set(Z),J.uniformMatrix3fv(this.addr,!1,GZ),I6($,Z)}}function jU(J,Q){let $=this.cache,Z=Q.elements;if(Z===void 0){if(V6($,Q))return;J.uniformMatrix4fv(this.addr,!1,Q),I6($,Q)}else{if(V6($,Z))return;XZ.set(Z),J.uniformMatrix4fv(this.addr,!1,XZ),I6($,Z)}}function yU(J,Q){let $=this.cache;if($[0]===Q)return;J.uniform1i(this.addr,Q),$[0]=Q}function vU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y)J.uniform2i(this.addr,Q.x,Q.y),$[0]=Q.x,$[1]=Q.y}else{if(V6($,Q))return;J.uniform2iv(this.addr,Q),I6($,Q)}}function fU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z)J.uniform3i(this.addr,Q.x,Q.y,Q.z),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z}else{if(V6($,Q))return;J.uniform3iv(this.addr,Q),I6($,Q)}}function bU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z||$[3]!==Q.w)J.uniform4i(this.addr,Q.x,Q.y,Q.z,Q.w),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z,$[3]=Q.w}else{if(V6($,Q))return;J.uniform4iv(this.addr,Q),I6($,Q)}}function hU(J,Q){let $=this.cache;if($[0]===Q)return;J.uniform1ui(this.addr,Q),$[0]=Q}function xU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y)J.uniform2ui(this.addr,Q.x,Q.y),$[0]=Q.x,$[1]=Q.y}else{if(V6($,Q))return;J.uniform2uiv(this.addr,Q),I6($,Q)}}function gU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z)J.uniform3ui(this.addr,Q.x,Q.y,Q.z),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z}else{if(V6($,Q))return;J.uniform3uiv(this.addr,Q),I6($,Q)}}function pU(J,Q){let $=this.cache;if(Q.x!==void 0){if($[0]!==Q.x||$[1]!==Q.y||$[2]!==Q.z||$[3]!==Q.w)J.uniform4ui(this.addr,Q.x,Q.y,Q.z,Q.w),$[0]=Q.x,$[1]=Q.y,$[2]=Q.z,$[3]=Q.w}else{if(V6($,Q))return;J.uniform4uiv(this.addr,Q),I6($,Q)}}function b5(J){if(J.version===0)J.compareFunction=EJ,J.needsUpdate=!0;return J}function mU(J,Q,$){let Z=this.cache,W=$.allocateTextureUnit();if(Z[0]!==W)J.uniform1i(this.addr,W),Z[0]=W;let q;if(this.type===J.SAMPLER_2D_SHADOW)q=b5(TZ);else q=wZ;$.setTexture2D(Q||q,W)}function lU(J,Q,$){let Z=this.cache,W=$.allocateTextureUnit();if(Z[0]!==W)J.uniform1i(this.addr,W),Z[0]=W;$.setTexture3D(Q||yZ,W)}function dU(J,Q,$){let Z=this.cache,W=$.allocateTextureUnit();if(Z[0]!==W)J.uniform1i(this.addr,W),Z[0]=W;let q;if(this.type===J.SAMPLER_CUBE_SHADOW)q=b5(SZ);else q=vZ;$.setTextureCube(Q||q,W)}function uU(J,Q,$){let Z=this.cache,W=$.allocateTextureUnit();if(Z[0]!==W)J.uniform1i(this.addr,W),Z[0]=W;$.setTexture2DArray(Q||jZ,W)}function cU(J){switch(J){case 5126:return _U;case 35664:return CU;case 35665:return PU;case 35666:return wU;case 35674:return TU;case 35675:return SU;case 35676:return jU;case 5124:case 35670:return yU;case 35667:case 35671:return vU;case 35668:case 35672:return fU;case 35669:case 35673:return bU;case 5125:return hU;case 36294:return xU;case 36295:return gU;case 36296:return pU;case 35678:case 36198:case 36298:case 36306:case 35682:return mU;case 35679:case 36299:case 36307:return lU;case 35680:case 36300:case 36308:case 36293:return dU;case 36289:case 36303:case 36311:case 36292:return uU}}function nU(J,Q){J.uniform1fv(this.addr,Q)}function sU(J,Q){let $=m9(Q,this.size,2);J.uniform2fv(this.addr,$)}function iU(J,Q){let $=m9(Q,this.size,3);J.uniform3fv(this.addr,$)}function oU(J,Q){let $=m9(Q,this.size,4);J.uniform4fv(this.addr,$)}function aU(J,Q){let $=m9(Q,this.size,4);J.uniformMatrix2fv(this.addr,!1,$)}function rU(J,Q){let $=m9(Q,this.size,9);J.uniformMatrix3fv(this.addr,!1,$)}function tU(J,Q){let $=m9(Q,this.size,16);J.uniformMatrix4fv(this.addr,!1,$)}function eU(J,Q){J.uniform1iv(this.addr,Q)}function JY(J,Q){J.uniform2iv(this.addr,Q)}function QY(J,Q){J.uniform3iv(this.addr,Q)}function $Y(J,Q){J.uniform4iv(this.addr,Q)}function ZY(J,Q){J.uniform1uiv(this.addr,Q)}function WY(J,Q){J.uniform2uiv(this.addr,Q)}function qY(J,Q){J.uniform3uiv(this.addr,Q)}function KY(J,Q){J.uniform4uiv(this.addr,Q)}function HY(J,Q,$){let Z=this.cache,W=Q.length,q=f5($,W);if(!V6(Z,q))J.uniform1iv(this.addr,q),I6(Z,q);let K;if(this.type===J.SAMPLER_2D_SHADOW)K=b5(TZ);else K=wZ;for(let H=0;H!==W;++H)$.setTexture2D(Q[H]||K,q[H])}function UY(J,Q,$){let Z=this.cache,W=Q.length,q=f5($,W);if(!V6(Z,q))J.uniform1iv(this.addr,q),I6(Z,q);for(let K=0;K!==W;++K)$.setTexture3D(Q[K]||yZ,q[K])}function YY(J,Q,$){let Z=this.cache,W=Q.length,q=f5($,W);if(!V6(Z,q))J.uniform1iv(this.addr,q),I6(Z,q);let K;if(this.type===J.SAMPLER_CUBE_SHADOW)K=b5(SZ);else K=vZ;for(let H=0;H!==W;++H)$.setTextureCube(Q[H]||K,q[H])}function XY(J,Q,$){let Z=this.cache,W=Q.length,q=f5($,W);if(!V6(Z,q))J.uniform1iv(this.addr,q),I6(Z,q);for(let K=0;K!==W;++K)$.setTexture2DArray(Q[K]||jZ,q[K])}function GY(J){switch(J){case 5126:return nU;case 35664:return sU;case 35665:return iU;case 35666:return oU;case 35674:return aU;case 35675:return rU;case 35676:return tU;case 5124:case 35670:return eU;case 35667:case 35671:return JY;case 35668:case 35672:return QY;case 35669:case 35673:return $Y;case 5125:return ZY;case 36294:return WY;case 36295:return qY;case 36296:return KY;case 35678:case 36198:case 36298:case 36306:case 35682:return HY;case 35679:case 36299:case 36307:return UY;case 35680:case 36300:case 36308:case 36293:return YY;case 36289:case 36303:case 36311:case 36292:return XY}}class fZ{constructor(J,Q,$){this.id=J,this.addr=$,this.cache=[],this.type=Q.type,this.setValue=cU(Q.type)}}class bZ{constructor(J,Q,$){this.id=J,this.addr=$,this.cache=[],this.type=Q.type,this.size=Q.size,this.setValue=GY(Q.type)}}class hZ{constructor(J){this.id=J,this.seq=[],this.map={}}setValue(J,Q,$){let Z=this.seq;for(let W=0,q=Z.length;W!==q;++W){let K=Z[W];K.setValue(J,Q[K.id],$)}}}var iJ=/(\w+)(\])?(\[|\.)?/g;function EZ(J,Q){J.seq.push(Q),J.map[Q.id]=Q}function NY(J,Q,$){let Z=J.name,W=Z.length;iJ.lastIndex=0;while(!0){let q=iJ.exec(Z),K=iJ.lastIndex,H=q[1],U=q[2]==="]",Y=q[3];if(U)H=H|0;if(Y===void 0||Y==="["&&K+2===W){EZ($,Y===void 0?new fZ(H,J,Q):new bZ(H,J,Q));break}else{let G=$.map[H];if(G===void 0)G=new hZ(H),EZ($,G);$=G}}}class k0{constructor(J,Q){this.seq=[],this.map={};let $=J.getProgramParameter(Q,J.ACTIVE_UNIFORMS);for(let q=0;q<$;++q){let K=J.getActiveUniform(Q,q),H=J.getUniformLocation(Q,K.name);NY(K,H,this)}let Z=[],W=[];for(let q of this.seq)if(q.type===J.SAMPLER_2D_SHADOW||q.type===J.SAMPLER_CUBE_SHADOW||q.type===J.SAMPLER_2D_ARRAY_SHADOW)Z.push(q);else W.push(q);if(Z.length>0)this.seq=Z.concat(W)}setValue(J,Q,$,Z){let W=this.map[Q];if(W!==void 0)W.setValue(J,$,Z)}setOptional(J,Q,$){let Z=Q[$];if(Z!==void 0)this.setValue(J,$,Z)}static upload(J,Q,$,Z){for(let W=0,q=Q.length;W!==q;++W){let K=Q[W],H=$[K.id];if(H.needsUpdate!==!1)K.setValue(J,H.value,Z)}}static seqWithValue(J,Q){let $=[];for(let Z=0,W=J.length;Z!==W;++Z){let q=J[Z];if(q.id in Q)$.push(q)}return $}}function FZ(J,Q,$){let Z=J.createShader(Q);return J.shaderSource(Z,$),J.compileShader(Z),Z}var EY=37297,FY=0;function DY(J,Q){let $=J.split(`
`),Z=[],W=Math.max(Q-6,0),q=Math.min(Q+6,$.length);for(let K=W;K<q;K++){let H=K+1;Z.push(`${H===Q?">":" "} ${H}: ${$[K]}`)}return Z.join(`
`)}var DZ=new i8;function OY(J){K6._getMatrix(DZ,K6.workingColorSpace,J);let Q=`mat3( ${DZ.elements.map(($)=>$.toFixed(4))} )`;switch(K6.getTransfer(J)){case XJ:return[Q,"LinearTransferOETF"];case E6:return[Q,"sRGBTransferOETF"];default:return t8("WebGLProgram: Unsupported color space: ",J),[Q,"LinearTransferOETF"]}}function OZ(J,Q,$){let Z=J.getShaderParameter(Q,J.COMPILE_STATUS),q=(J.getShaderInfoLog(Q)||"").trim();if(Z&&q==="")return"";let K=/ERROR: 0:(\d+)/.exec(q);if(K){let H=parseInt(K[1]);return $.toUpperCase()+`

`+q+`

`+DY(J.getShaderSource(Q),H)}else return q}function RY(J,Q){let $=OY(Q);return[`vec4 ${J}( vec4 value ) {`,`	return ${$[1]}( vec4( ${$[0]} * value.rgb, value.a ) );`,"}"].join(`
`)}var MY={[L1]:"Linear",[B1]:"Reinhard",[z1]:"Cineon",[H0]:"ACESFilmic",[I1]:"AgX",[A1]:"Neutral",[V1]:"Custom"};function kY(J,Q){let $=MY[Q];if($===void 0)return t8("WebGLProgram: Unsupported toneMapping:",Q),"vec3 "+J+"( vec3 color ) { return LinearToneMapping( color ); }";return"vec3 "+J+"( vec3 color ) { return "+$+"ToneMapping( color ); }"}var y5=new u;function LY(){K6.getLuminanceCoefficients(y5);let J=y5.x.toFixed(4),Q=y5.y.toFixed(4),$=y5.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${J}, ${Q}, ${$} );`,"\treturn dot( weights, rgb );","}"].join(`
`)}function BY(J){return[J.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",J.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(M0).join(`
`)}function zY(J){let Q=[];for(let $ in J){let Z=J[$];if(Z===!1)continue;Q.push("#define "+$+" "+Z)}return Q.join(`
`)}function VY(J,Q){let $={},Z=J.getProgramParameter(Q,J.ACTIVE_ATTRIBUTES);for(let W=0;W<Z;W++){let q=J.getActiveAttrib(Q,W),K=q.name,H=1;if(q.type===J.FLOAT_MAT2)H=2;if(q.type===J.FLOAT_MAT3)H=3;if(q.type===J.FLOAT_MAT4)H=4;$[K]={type:q.type,location:J.getAttribLocation(Q,K),locationSize:H}}return $}function M0(J){return J!==""}function RZ(J,Q){let $=Q.numSpotLightShadows+Q.numSpotLightMaps-Q.numSpotLightShadowsWithMaps;return J.replace(/NUM_SUN_LIGHTS/g,Q.numSunLights).replace(/NUM_DIR_LIGHTS/g,Q.numDirLights).replace(/NUM_SPOT_LIGHTS/g,Q.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,Q.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,$).replace(/NUM_RECT_AREA_LIGHTS/g,Q.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,Q.numPointLights).replace(/NUM_HEMI_LIGHTS/g,Q.numHemiLights).replace(/NUM_SUN_LIGHT_SHADOWS/g,Q.numSunLightShadows).replace(/NUM_DIR_LIGHT_SHADOWS/g,Q.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,Q.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,Q.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,Q.numPointLightShadows).replace(/NUM_LIGHT_PROBE_GRIDS/g,Q.numLightProbeGrids)}function MZ(J,Q){return J.replace(/NUM_CLIPPING_PLANES/g,Q.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,Q.numClippingPlanes-Q.numClipIntersection)}var IY=/^[ \t]*#include +<([\w\d./]+)>/gm;function aJ(J){return J.replace(IY,AY)}function AY(J,Q){let $=$6[Q];if($===void 0)throw Error("THREE.WebGLProgram: Can not resolve #include <"+Q+">");return aJ($)}var _Y=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function kZ(J){return J.replace(_Y,CY)}function CY(J,Q,$,Z){let W="";for(let q=parseInt(Q);q<parseInt($);q++)W+=Z.replace(/\[\s*i\s*\]/g,"[ "+q+" ]").replace(/UNROLLED_LOOP_INDEX/g,q);return W}function LZ(J){let Q=`precision ${J.precision} float;
	precision ${J.precision} int;
	precision ${J.precision} sampler2D;
	precision ${J.precision} samplerCube;
	precision ${J.precision} sampler3D;
	precision ${J.precision} sampler2DArray;
	precision ${J.precision} sampler2DShadow;
	precision ${J.precision} samplerCubeShadow;
	precision ${J.precision} sampler2DArrayShadow;
	precision ${J.precision} isampler2D;
	precision ${J.precision} isampler3D;
	precision ${J.precision} isamplerCube;
	precision ${J.precision} isampler2DArray;
	precision ${J.precision} usampler2D;
	precision ${J.precision} usampler3D;
	precision ${J.precision} usamplerCube;
	precision ${J.precision} usampler2DArray;
	`;if(J.precision==="highp")Q+=`
#define HIGH_PRECISION`;else if(J.precision==="mediump")Q+=`
#define MEDIUM_PRECISION`;else if(J.precision==="lowp")Q+=`
#define LOW_PRECISION`;return Q}var PY={[q0]:"SHADOWMAP_TYPE_PCF",[P9]:"SHADOWMAP_TYPE_VSM"};function wY(J){return PY[J.shadowMapType]||"SHADOWMAP_TYPE_BASIC"}var TY={[S9]:"ENVMAP_MODE_REFRACTION"};function SY(J){if(J.envMap===!1)return"ENVMAP_MODE_REFLECTION";return TY[J.envMapMode]||"ENVMAP_MODE_REFLECTION"}var jY={[B$]:"ENVMAP_BLENDING_MULTIPLY",[z$]:"ENVMAP_BLENDING_MIX",[V$]:"ENVMAP_BLENDING_ADD"};function yY(J){if(J.envMap===!1)return"ENVMAP_BLENDING_NONE";return jY[J.combine]||"ENVMAP_BLENDING_NONE"}function vY(J,Q,$,Z){let W=J.getContext(),q=$.defines,K=$.vertexShader,H=$.fragmentShader,U=wY($),Y=$.envMapPMREM===!0?"ENVMAP_TYPE_PMREM":"ENVMAP_TYPE_CUBE",X=SY($),G=yY($),N=BY($),F=zY(q),M=W.createProgram(),L,E,O=$.glslVersion?"#version "+$.glslVersion+`
`:"";if($.isRawShaderMaterial){if(L=["#define SHADER_TYPE "+$.shaderType,"#define SHADER_NAME "+$.shaderName,F].filter(M0).join(`
`),L.length>0)L+=`
`;if(E=["#define SHADER_TYPE "+$.shaderType,"#define SHADER_NAME "+$.shaderName,F].filter(M0).join(`
`),E.length>0)E+=`
`}else L=[LZ($),"#define SHADER_TYPE "+$.shaderType,"#define SHADER_NAME "+$.shaderName,F,$.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",$.batching?"#define USE_BATCHING":"",$.batchingColor?"#define USE_BATCHING_COLOR":"",$.instancing?"#define USE_INSTANCING":"",$.instancingColor?"#define USE_INSTANCING_COLOR":"",$.instancingMorph?"#define USE_INSTANCING_MORPH":"",$.useFog&&$.fog?"#define USE_FOG":"",$.useFog&&$.fogExp2?"#define FOG_EXP2":"",$.map?"#define USE_MAP":"",$.envMap?"#define USE_ENVMAP":"",$.envMap?"#define "+X:"",$.lightMap?"#define USE_LIGHTMAP":"",$.aoMap?"#define USE_AOMAP":"",$.bumpMap?"#define USE_BUMPMAP":"",$.normalMap?"#define USE_NORMALMAP":"",$.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",$.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",$.displacementMap?"#define USE_DISPLACEMENTMAP":"",$.emissiveMap?"#define USE_EMISSIVEMAP":"",$.anisotropy?"#define USE_ANISOTROPY":"",$.anisotropyMap?"#define USE_ANISOTROPYMAP":"",$.clearcoatMap?"#define USE_CLEARCOATMAP":"",$.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",$.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",$.diffuseRoughnessMap?"#define USE_DIFFUSE_ROUGHNESSMAP":"",$.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",$.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",$.specularMap?"#define USE_SPECULARMAP":"",$.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",$.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",$.roughnessMap?"#define USE_ROUGHNESSMAP":"",$.metalnessMap?"#define USE_METALNESSMAP":"",$.alphaMap?"#define USE_ALPHAMAP":"",$.alphaHash?"#define USE_ALPHAHASH":"",$.transmission?"#define USE_TRANSMISSION":"",$.transmissionMap?"#define USE_TRANSMISSIONMAP":"",$.thicknessMap?"#define USE_THICKNESSMAP":"",$.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",$.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",$.mapUv?"#define MAP_UV "+$.mapUv:"",$.alphaMapUv?"#define ALPHAMAP_UV "+$.alphaMapUv:"",$.lightMapUv?"#define LIGHTMAP_UV "+$.lightMapUv:"",$.aoMapUv?"#define AOMAP_UV "+$.aoMapUv:"",$.emissiveMapUv?"#define EMISSIVEMAP_UV "+$.emissiveMapUv:"",$.bumpMapUv?"#define BUMPMAP_UV "+$.bumpMapUv:"",$.normalMapUv?"#define NORMALMAP_UV "+$.normalMapUv:"",$.displacementMapUv?"#define DISPLACEMENTMAP_UV "+$.displacementMapUv:"",$.metalnessMapUv?"#define METALNESSMAP_UV "+$.metalnessMapUv:"",$.roughnessMapUv?"#define ROUGHNESSMAP_UV "+$.roughnessMapUv:"",$.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+$.anisotropyMapUv:"",$.clearcoatMapUv?"#define CLEARCOATMAP_UV "+$.clearcoatMapUv:"",$.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+$.clearcoatNormalMapUv:"",$.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+$.clearcoatRoughnessMapUv:"",$.diffuseRoughnessMapUv?"#define DIFFUSE_ROUGHNESSMAP_UV "+$.diffuseRoughnessMapUv:"",$.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+$.iridescenceMapUv:"",$.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+$.iridescenceThicknessMapUv:"",$.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+$.sheenColorMapUv:"",$.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+$.sheenRoughnessMapUv:"",$.specularMapUv?"#define SPECULARMAP_UV "+$.specularMapUv:"",$.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+$.specularColorMapUv:"",$.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+$.specularIntensityMapUv:"",$.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+$.transmissionMapUv:"",$.thicknessMapUv?"#define THICKNESSMAP_UV "+$.thicknessMapUv:"",$.vertexTangents&&$.flatShading===!1?"#define USE_TANGENT":"",$.vertexNormals?"#define HAS_NORMAL":"",$.vertexColors?"#define USE_COLOR":"",$.vertexAlphas?"#define USE_COLOR_ALPHA":"",$.vertexUv1s?"#define USE_UV1":"",$.vertexUv2s?"#define USE_UV2":"",$.vertexUv3s?"#define USE_UV3":"",$.pointsUvs?"#define USE_POINTS_UV":"",$.flatShading?"#define FLAT_SHADED":"",$.skinning?"#define USE_SKINNING":"",$.morphTargets?"#define USE_MORPHTARGETS":"",$.morphNormals&&$.flatShading===!1?"#define USE_MORPHNORMALS":"",$.morphColors?"#define USE_MORPHCOLORS":"",$.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+$.morphTextureStride:"",$.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+$.morphTargetsCount:"",$.doubleSided?"#define DOUBLE_SIDED":"",$.flipSided?"#define FLIP_SIDED":"",$.shadowMapEnabled?"#define USE_SHADOWMAP":"",$.shadowMapEnabled?"#define "+U:"",$.sizeAttenuation?"#define USE_SIZEATTENUATION":"",$.numLightProbes>0?"#define USE_LIGHT_PROBES":"",$.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",$.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","\tattribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","\tattribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","\tuniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","\tattribute vec2 uv1;","#endif","#ifdef USE_UV2","\tattribute vec2 uv2;","#endif","#ifdef USE_UV3","\tattribute vec2 uv3;","#endif","#ifdef USE_TANGENT","\tattribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","\tattribute vec4 color;","#elif defined( USE_COLOR )","\tattribute vec3 color;","#endif","#ifdef USE_SKINNING","\tattribute vec4 skinIndex;","\tattribute vec4 skinWeight;","#endif",`
`].filter(M0).join(`
`),E=[LZ($),"#define SHADER_TYPE "+$.shaderType,"#define SHADER_NAME "+$.shaderName,F,$.useFog&&$.fog?"#define USE_FOG":"",$.useFog&&$.fogExp2?"#define FOG_EXP2":"",$.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",$.map?"#define USE_MAP":"",$.matcap?"#define USE_MATCAP":"",$.envMap?"#define USE_ENVMAP":"",$.envMap?"#define "+Y:"",$.envMap?"#define "+X:"",$.envMap?"#define "+G:"",$.envMapPMREM?"#define ENVMAP_MAX_LOD "+$.envMapMaxLod+".0":"",$.envMapPMREM?"#define ENVMAP_SIZE "+$.envMapSize+".0":"",$.lightMap?"#define USE_LIGHTMAP":"",$.aoMap?"#define USE_AOMAP":"",$.bumpMap?"#define USE_BUMPMAP":"",$.normalMap?"#define USE_NORMALMAP":"",$.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",$.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",$.packedNormalMap?"#define USE_PACKED_NORMALMAP":"",$.emissiveMap?"#define USE_EMISSIVEMAP":"",$.anisotropy?"#define USE_ANISOTROPY":"",$.anisotropyMap?"#define USE_ANISOTROPYMAP":"",$.clearcoat?"#define USE_CLEARCOAT":"",$.clearcoatMap?"#define USE_CLEARCOATMAP":"",$.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",$.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",$.diffuseRoughness?"#define USE_DIFFUSE_ROUGHNESS":"",$.diffuseRoughnessMap?"#define USE_DIFFUSE_ROUGHNESSMAP":"",$.dispersion?"#define USE_DISPERSION":"",$.retroreflection?"#define USE_RETROREFLECTION":"",$.iridescence?"#define USE_IRIDESCENCE":"",$.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",$.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",$.specularMap?"#define USE_SPECULARMAP":"",$.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",$.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",$.roughnessMap?"#define USE_ROUGHNESSMAP":"",$.metalnessMap?"#define USE_METALNESSMAP":"",$.alphaMap?"#define USE_ALPHAMAP":"",$.alphaTest?"#define USE_ALPHATEST":"",$.alphaHash?"#define USE_ALPHAHASH":"",$.sheen?"#define USE_SHEEN":"",$.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",$.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",$.transmission?"#define USE_TRANSMISSION":"",$.transmissionMap?"#define USE_TRANSMISSIONMAP":"",$.thicknessMap?"#define USE_THICKNESSMAP":"",$.vertexTangents&&$.flatShading===!1?"#define USE_TANGENT":"",$.vertexColors||$.instancingColor?"#define USE_COLOR":"",$.vertexAlphas||$.batchingColor?"#define USE_COLOR_ALPHA":"",$.vertexUv1s?"#define USE_UV1":"",$.vertexUv2s?"#define USE_UV2":"",$.vertexUv3s?"#define USE_UV3":"",$.pointsUvs?"#define USE_POINTS_UV":"",$.gradientMap?"#define USE_GRADIENTMAP":"",$.flatShading?"#define FLAT_SHADED":"",$.doubleSided?"#define DOUBLE_SIDED":"",$.flipSided?"#define FLIP_SIDED":"",$.shadowMapEnabled?"#define USE_SHADOWMAP":"",$.shadowMapEnabled?"#define "+U:"",$.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",$.numLightProbes>0?"#define USE_LIGHT_PROBES":"",$.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",$.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",$.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",$.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",$.toneMapping!==X7?"#define TONE_MAPPING":"",$.toneMapping!==X7?$6.tonemapping_pars_fragment:"",$.toneMapping!==X7?kY("toneMapping",$.toneMapping):"",$.dithering?"#define DITHERING":"",$.opaque?"#define OPAQUE":"",$6.colorspace_pars_fragment,RY("linearToOutputTexel",$.outputColorSpace),LY(),$.useDepthPacking?"#define DEPTH_PACKING "+$.depthPacking:"",`
`].filter(M0).join(`
`);if(K=aJ(K),K=RZ(K,$),K=MZ(K,$),H=aJ(H),H=RZ(H,$),H=MZ(H,$),K=kZ(K),H=kZ(H),$.isRawShaderMaterial!==!0)O=`#version 300 es
`,L=[N,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+L,E=["#define varying in",$.glslVersion===FJ?"":"layout(location = 0) out highp vec4 pc_fragColor;",$.glslVersion===FJ?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+E;let _=O+L+K,V=O+E+H,B=FZ(W,W.VERTEX_SHADER,_),w=FZ(W,W.FRAGMENT_SHADER,V);if(W.attachShader(M,B),W.attachShader(M,w),$.index0AttributeName!==void 0)W.bindAttribLocation(M,0,$.index0AttributeName);else if($.hasPositionAttribute===!0)W.bindAttribLocation(M,0,"position");W.linkProgram(M);function y(t){if(J.debug.checkShaderErrors){let v=W.getProgramInfoLog(M)||"",J8=W.getShaderInfoLog(B)||"",E8=W.getShaderInfoLog(w)||"",T=v.trim(),H8=J8.trim(),e=E8.trim(),S=!0,B8=!0;if(W.getProgramParameter(M,W.LINK_STATUS)===!1)if(S=!1,typeof J.debug.onShaderError==="function")J.debug.onShaderError(W,M,B,w);else{let i=OZ(W,B,"vertex"),X8=OZ(W,w,"fragment");e8("WebGLProgram: Shader Error "+W.getError()+" - VALIDATE_STATUS "+W.getProgramParameter(M,W.VALIDATE_STATUS)+`

Material Name: `+t.name+`
Material Type: `+t.type+`

Program Info Log: `+T+`
`+i+`
`+X8)}else if(T!=="")t8("WebGLProgram: Program Info Log:",T);else if(H8===""||e==="")B8=!1;if(B8)t.diagnostics={runnable:S,programLog:T,vertexShader:{log:H8,prefix:L},fragmentShader:{log:e,prefix:E}}}W.deleteShader(B),W.deleteShader(w),D=new k0(W,M),z=VY(W,M)}let D;this.getUniforms=function(){if(D===void 0)y(this);return D};let z;this.getAttributes=function(){if(z===void 0)y(this);return z};let m=$.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){if(m===!1)m=W.getProgramParameter(M,EY);return m},this.destroy=function(){Z.releaseStatesOfProgram(this),W.deleteProgram(M),this.program=void 0},this.type=$.shaderType,this.name=$.shaderName,this.id=FY++,this.cacheKey=Q,this.usedTimes=1,this.program=M,this.vertexShader=B,this.fragmentShader=w,this}var fY=0;class xZ{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(J,Q,$){let Z=this._getShaderCacheForMaterial(J);if(Z.has(Q)===!1)Z.add(Q),Q.usedTimes++;if(Z.has($)===!1)Z.add($),$.usedTimes++;return this}remove(J){let Q=this.materialCache.get(J);for(let $ of Q)if($.usedTimes--,$.usedTimes===0)this.shaderCache.delete($.code);return this.materialCache.delete(J),this}getVertexShaderStage(J){return this._getShaderStage(J.vertexShader)}getFragmentShaderStage(J){return this._getShaderStage(J.fragmentShader)}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(J){let Q=this.materialCache,$=Q.get(J);if($===void 0)$=new Set,Q.set(J,$);return $}_getShaderStage(J){let Q=this.shaderCache,$=Q.get(J);if($===void 0)$=new gZ(J),Q.set(J,$);return $}}class gZ{constructor(J){this.id=fY++,this.code=J,this.usedTimes=0}}function bY(J){return J===t7||J===K5||J===H5}function hY(J,Q,$,Z,W,q){let K=new X5,H=new xZ,U=new Set,Y=[],X=new Map,G=Z.logarithmicDepthBuffer,N={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distance",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function F(D){if(U.add(D),D===0)return"uv";return`uv${D}`}function M(D,z,m,t,v,J8){let E8=t.fog,T=v.geometry,H8=D.isMeshStandardMaterial||D.isMeshLambertMaterial||D.isMeshPhongMaterial?t.environment:null,e=D.isMeshStandardMaterial||D.isMeshLambertMaterial&&!D.envMap||D.isMeshPhongMaterial&&!D.envMap,S=Q.get(D.envMap||H8,e),B8=N[D.type],i=Z.precision;if(D.precision!==null){if(i=Z.getMaxPrecision(D.precision),i!==D.precision)t8("WebGLProgram.getParameters:",D.precision,"not supported, using",i,"instead.")}let X8=T.morphAttributes.position||T.morphAttributes.normal||T.morphAttributes.color,V8=X8!==void 0?X8.length:0,v8=0;if(T.morphAttributes.position!==void 0)v8=1;if(T.morphAttributes.normal!==void 0)v8=2;if(T.morphAttributes.color!==void 0)v8=3;let U8,M8,b8,n;if(B8){let g8=E7[B8];U8=g8.vertexShader,M8=g8.fragmentShader}else{U8=D.vertexShader,M8=D.fragmentShader;let g8=H.getVertexShaderStage(D),X6=H.getFragmentShaderStage(D);H.update(D,g8,X6),b8=g8.id,n=X6.id}let d=J.getRenderTarget(),P=J.state.buffers.depth.getReversed(),C=v.isInstancedMesh===!0,g=v.isBatchedMesh===!0,K8=!!D.map,D8=!!D.matcap,A=!!S,l=A&&S.isPMREMTexture===!0,j=!!D.aoMap,o=!!D.lightMap,s=!!D.bumpMap&&D.wireframe===!1,q8=!!D.normalMap,N8=!!D.displacementMap,h=!!D.emissiveMap,x=!!D.metalnessMap,k8=!!D.roughnessMap,f=D.anisotropy>0,Y8=D.clearcoat>0,Z8=D.diffuseRoughness>0,A8=D.dispersion>0,Q8=D.retroreflectivity>0,m8=D.iridescence>0,f8=D.sheen>0,j8=D.transmission>0,l8=f&&!!D.anisotropyMap,I=Y8&&!!D.clearcoatMap,R=Y8&&!!D.clearcoatNormalMap,c=Y8&&!!D.clearcoatRoughnessMap,z8=Z8&&!!D.diffuseRoughnessMap,R8=m8&&!!D.iridescenceMap,I8=m8&&!!D.iridescenceThicknessMap,P8=f8&&!!D.sheenColorMap,W8=f8&&!!D.sheenRoughnessMap,O8=!!D.specularMap,w8=!!D.specularColorMap,b=!!D.specularIntensityMap,F8=j8&&!!D.transmissionMap,G8=j8&&!!D.thicknessMap,_8=!!D.gradientMap,C8=!!D.alphaMap,y8=D.alphaTest>0,o8=!!D.alphaHash,s8=!!D.extensions,x8=X7;if(D.toneMapped){if(d===null||d.isXRRenderTarget===!0)x8=J.toneMapping}let a8=l?S.isCompressedCubeTexture?S.image[0].mipmaps:S.mipmaps:null,Q6={shaderID:B8,shaderType:D.type,shaderName:D.name,vertexShader:U8,fragmentShader:M8,defines:D.defines,customVertexShaderID:b8,customFragmentShaderID:n,isRawShaderMaterial:D.isRawShaderMaterial===!0,glslVersion:D.glslVersion,precision:i,batching:g,batchingColor:g&&v._colorsTexture!==null,instancing:C,instancingColor:C&&v.instanceColor!==null,instancingMorph:C&&v.morphTexture!==null,outputColorSpace:d===null?J.outputColorSpace:d.isXRRenderTarget===!0?d.texture.colorSpace:K6.workingColorSpace,alphaToCoverage:!!D.alphaToCoverage,map:K8,matcap:D8,envMap:A,envMapMode:A&&S.mapping,envMapPMREM:l,envMapMaxLod:l?a8.length-1:null,envMapSize:l?a8[0].width:null,aoMap:j,lightMap:o,bumpMap:s,normalMap:q8,displacementMap:N8,emissiveMap:h,normalMapObjectSpace:q8&&D.normalMapType===j$,normalMapTangentSpace:q8&&D.normalMapType===UJ,packedNormalMap:q8&&D.normalMapType===UJ&&bY(D.normalMap.format),metalnessMap:x,roughnessMap:k8,anisotropy:f,anisotropyMap:l8,clearcoat:Y8,clearcoatMap:I,clearcoatNormalMap:R,clearcoatRoughnessMap:c,diffuseRoughness:Z8,diffuseRoughnessMap:z8,dispersion:A8,retroreflection:Q8,iridescence:m8,iridescenceMap:R8,iridescenceThicknessMap:I8,sheen:f8,sheenColorMap:P8,sheenRoughnessMap:W8,specularMap:O8,specularColorMap:w8,specularIntensityMap:b,transmission:j8,transmissionMap:F8,thicknessMap:G8,gradientMap:_8,opaque:D.transparent===!1&&D.blending===K0&&D.alphaToCoverage===!1,alphaMap:C8,alphaTest:y8,alphaHash:o8,combine:D.combine,mapUv:K8&&F(D.map.channel),aoMapUv:j&&F(D.aoMap.channel),lightMapUv:o&&F(D.lightMap.channel),bumpMapUv:s&&F(D.bumpMap.channel),normalMapUv:q8&&F(D.normalMap.channel),displacementMapUv:N8&&F(D.displacementMap.channel),emissiveMapUv:h&&F(D.emissiveMap.channel),metalnessMapUv:x&&F(D.metalnessMap.channel),roughnessMapUv:k8&&F(D.roughnessMap.channel),anisotropyMapUv:l8&&F(D.anisotropyMap.channel),clearcoatMapUv:I&&F(D.clearcoatMap.channel),clearcoatNormalMapUv:R&&F(D.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:c&&F(D.clearcoatRoughnessMap.channel),diffuseRoughnessMapUv:z8&&F(D.diffuseRoughnessMap.channel),iridescenceMapUv:R8&&F(D.iridescenceMap.channel),iridescenceThicknessMapUv:I8&&F(D.iridescenceThicknessMap.channel),sheenColorMapUv:P8&&F(D.sheenColorMap.channel),sheenRoughnessMapUv:W8&&F(D.sheenRoughnessMap.channel),specularMapUv:O8&&F(D.specularMap.channel),specularColorMapUv:w8&&F(D.specularColorMap.channel),specularIntensityMapUv:b&&F(D.specularIntensityMap.channel),transmissionMapUv:F8&&F(D.transmissionMap.channel),thicknessMapUv:G8&&F(D.thicknessMap.channel),alphaMapUv:C8&&F(D.alphaMap.channel),vertexTangents:!!T.attributes.tangent&&(q8||f),vertexNormals:!!T.attributes.normal,vertexColors:D.vertexColors,vertexAlphas:D.vertexColors===!0&&!!T.attributes.color&&T.attributes.color.itemSize===4,pointsUvs:v.isPoints===!0&&!!T.attributes.uv&&(K8||C8),fog:!!E8,useFog:D.fog===!0,fogExp2:!!E8&&E8.isFogExp2,flatShading:D.wireframe===!1&&(D.flatShading===!0||T.attributes.normal===void 0&&q8===!1&&(D.isMeshLambertMaterial||D.isMeshPhongMaterial||D.isMeshStandardMaterial||D.isMeshPhysicalMaterial)),sizeAttenuation:D.sizeAttenuation===!0,logarithmicDepthBuffer:G,reversedDepthBuffer:P,skinning:v.isSkinnedMesh===!0,hasPositionAttribute:T.attributes.position!==void 0,morphTargets:T.morphAttributes.position!==void 0,morphNormals:T.morphAttributes.normal!==void 0,morphColors:T.morphAttributes.color!==void 0,morphTargetsCount:V8,morphTextureStride:v8,numSunLights:z.sun.length,numDirLights:z.directional.length,numPointLights:z.point.length,numSpotLights:z.spot.length,numSpotLightMaps:z.spotLightMap.length,numRectAreaLights:z.rectArea.length,numHemiLights:z.hemi.length,numSunLightShadows:z.sunShadowMap.length,numDirLightShadows:z.directionalShadowMap.length,numPointLightShadows:z.pointShadowMap.length,numSpotLightShadows:z.spotShadowMap.length,numSpotLightShadowsWithMaps:z.numSpotLightShadowsWithMaps,numLightProbes:z.numLightProbes,numLightProbeGrids:J8.filter((g8)=>g8.texture!==null).length,numClippingPlanes:q.numPlanes,numClipIntersection:q.numIntersection,dithering:D.dithering,shadowMapEnabled:J.shadowMap.enabled&&m.length>0,shadowMapType:J.shadowMap.type,toneMapping:x8,decodeVideoTexture:K8&&D.map.isVideoTexture===!0&&K6.getTransfer(D.map.colorSpace)===E6,decodeVideoTextureEmissive:h&&D.emissiveMap.isVideoTexture===!0&&K6.getTransfer(D.emissiveMap.colorSpace)===E6,premultipliedAlpha:D.premultipliedAlpha,doubleSided:D.side===m6,flipSided:D.side===f6,useDepthPacking:D.depthPacking>=0,depthPacking:D.depthPacking||0,index0AttributeName:D.index0AttributeName,extensionClipCullDistance:s8&&D.extensions.clipCullDistance===!0&&$.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(s8&&D.extensions.multiDraw===!0||g)&&$.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:$.has("KHR_parallel_shader_compile"),customProgramCacheKey:D.customProgramCacheKey()};return Q6.vertexUv1s=U.has(1),Q6.vertexUv2s=U.has(2),Q6.vertexUv3s=U.has(3),U.clear(),Q6}function L(D){let z=[];if(D.shaderID)z.push(D.shaderID);else z.push(D.customVertexShaderID),z.push(D.customFragmentShaderID);if(D.defines!==void 0)for(let m in D.defines)z.push(m),z.push(D.defines[m]);if(D.isRawShaderMaterial===!1)E(z,D),O(z,D),z.push(J.outputColorSpace);return z.push(D.customProgramCacheKey),z.join()}function E(D,z){D.push(z.precision),D.push(z.outputColorSpace),D.push(z.envMapMode),D.push(z.envMapPMREM),D.push(z.envMapMaxLod),D.push(z.envMapSize),D.push(z.mapUv),D.push(z.alphaMapUv),D.push(z.lightMapUv),D.push(z.aoMapUv),D.push(z.bumpMapUv),D.push(z.normalMapUv),D.push(z.displacementMapUv),D.push(z.emissiveMapUv),D.push(z.metalnessMapUv),D.push(z.roughnessMapUv),D.push(z.anisotropyMapUv),D.push(z.clearcoatMapUv),D.push(z.clearcoatNormalMapUv),D.push(z.clearcoatRoughnessMapUv),D.push(z.diffuseRoughnessMapUv),D.push(z.iridescenceMapUv),D.push(z.iridescenceThicknessMapUv),D.push(z.sheenColorMapUv),D.push(z.sheenRoughnessMapUv),D.push(z.specularMapUv),D.push(z.specularColorMapUv),D.push(z.specularIntensityMapUv),D.push(z.transmissionMapUv),D.push(z.thicknessMapUv),D.push(z.combine),D.push(z.fogExp2),D.push(z.sizeAttenuation),D.push(z.morphTargetsCount),D.push(z.numSunLights),D.push(z.numDirLights),D.push(z.numPointLights),D.push(z.numSpotLights),D.push(z.numSpotLightMaps),D.push(z.numHemiLights),D.push(z.numRectAreaLights),D.push(z.numSunLightShadows),D.push(z.numDirLightShadows),D.push(z.numPointLightShadows),D.push(z.numSpotLightShadows),D.push(z.numSpotLightShadowsWithMaps),D.push(z.numLightProbes),D.push(z.numLightProbeGrids),D.push(z.shadowMapType),D.push(z.toneMapping),D.push(z.numClippingPlanes),D.push(z.numClipIntersection),D.push(z.depthPacking)}function O(D,z){if(K.disableAll(),z.instancing)K.enable(0);if(z.instancingColor)K.enable(1);if(z.instancingMorph)K.enable(2);if(z.matcap)K.enable(3);if(z.envMap)K.enable(4);if(z.normalMapObjectSpace)K.enable(5);if(z.normalMapTangentSpace)K.enable(6);if(z.clearcoat)K.enable(7);if(z.iridescence)K.enable(8);if(z.alphaTest)K.enable(9);if(z.vertexColors)K.enable(10);if(z.vertexAlphas)K.enable(11);if(z.vertexUv1s)K.enable(12);if(z.vertexUv2s)K.enable(13);if(z.vertexUv3s)K.enable(14);if(z.vertexTangents)K.enable(15);if(z.anisotropy)K.enable(16);if(z.alphaHash)K.enable(17);if(z.batching)K.enable(18);if(z.dispersion)K.enable(19);if(z.retroreflection)K.enable(24);if(z.diffuseRoughness)K.enable(25);if(z.batchingColor)K.enable(20);if(z.gradientMap)K.enable(21);if(z.packedNormalMap)K.enable(22);if(z.vertexNormals)K.enable(23);if(D.push(K.mask),K.disableAll(),z.fog)K.enable(0);if(z.useFog)K.enable(1);if(z.flatShading)K.enable(2);if(z.logarithmicDepthBuffer)K.enable(3);if(z.reversedDepthBuffer)K.enable(4);if(z.skinning)K.enable(5);if(z.morphTargets)K.enable(6);if(z.morphNormals)K.enable(7);if(z.morphColors)K.enable(8);if(z.premultipliedAlpha)K.enable(9);if(z.shadowMapEnabled)K.enable(10);if(z.doubleSided)K.enable(11);if(z.flipSided)K.enable(12);if(z.useDepthPacking)K.enable(13);if(z.dithering)K.enable(14);if(z.transmission)K.enable(15);if(z.sheen)K.enable(16);if(z.opaque)K.enable(17);if(z.pointsUvs)K.enable(18);if(z.decodeVideoTexture)K.enable(19);if(z.decodeVideoTextureEmissive)K.enable(20);if(z.alphaToCoverage)K.enable(21);if(z.numLightProbeGrids>0)K.enable(22);if(z.hasPositionAttribute)K.enable(23);D.push(K.mask)}function _(D){let z=N[D.type],m;if(z){let t=E7[z];m=a$.clone(t.uniforms)}else m=D.uniforms;return m}function V(D,z){let m=X.get(z);if(m!==void 0)++m.usedTimes;else m=new vY(J,z,D,W),Y.push(m),X.set(z,m);return m}function B(D){if(--D.usedTimes===0){let z=Y.indexOf(D);Y[z]=Y[Y.length-1],Y.pop(),X.delete(D.cacheKey),D.destroy()}}function w(D){H.remove(D)}function y(){H.dispose()}return{getParameters:M,getProgramCacheKey:L,getUniforms:_,acquireProgram:V,releaseProgram:B,releaseShaderCache:w,programs:Y,dispose:y}}function xY(){let J=new WeakMap;function Q(K){return J.has(K)}function $(K){let H=J.get(K);if(H===void 0)H={},J.set(K,H);return H}function Z(K){J.delete(K)}function W(K,H,U){J.get(K)[H]=U}function q(){J=new WeakMap}return{has:Q,get:$,remove:Z,update:W,dispose:q}}function gY(J,Q){if(J.groupOrder!==Q.groupOrder)return J.groupOrder-Q.groupOrder;else if(J.renderOrder!==Q.renderOrder)return J.renderOrder-Q.renderOrder;else if(J.material.id!==Q.material.id)return J.material.id-Q.material.id;else if(J.materialVariant!==Q.materialVariant)return J.materialVariant-Q.materialVariant;else if(J.z!==Q.z)return J.z-Q.z;else return J.id-Q.id}function BZ(J,Q){if(J.groupOrder!==Q.groupOrder)return J.groupOrder-Q.groupOrder;else if(J.renderOrder!==Q.renderOrder)return J.renderOrder-Q.renderOrder;else if(J.z!==Q.z)return Q.z-J.z;else return J.id-Q.id}function zZ(){let J=[],Q=0,$=[],Z=[],W=[];function q(){Q=0,$.length=0,Z.length=0,W.length=0}function K(N){let F=0;if(N.isInstancedMesh)F+=2;if(N.isSkinnedMesh)F+=1;return F}function H(N,F,M,L,E,O){let _=J[Q];if(_===void 0)_={id:N.id,object:N,geometry:F,material:M,materialVariant:K(N),groupOrder:L,renderOrder:N.renderOrder,z:E,group:O},J[Q]=_;else _.id=N.id,_.object=N,_.geometry=F,_.material=M,_.materialVariant=K(N),_.groupOrder=L,_.renderOrder=N.renderOrder,_.z=E,_.group=O;return Q++,_}function U(N,F,M,L,E,O,_){if(_.reversedDepth===!0)E=-E;let V=H(N,F,M,L,E,O);if(M.transmission>0)Z.push(V);else if(M.transparent===!0)W.push(V);else $.push(V)}function Y(N,F,M,L,E,O){let _=H(N,F,M,L,E,O);if(M.transmission>0)Z.unshift(_);else if(M.transparent===!0)W.unshift(_);else $.unshift(_)}function X(N,F){if($.length>1)$.sort(N||gY);if(Z.length>1)Z.sort(F||BZ);if(W.length>1)W.sort(F||BZ)}function G(){for(let N=Q,F=J.length;N<F;N++){let M=J[N];if(M.id===null)break;M.id=null,M.object=null,M.geometry=null,M.material=null,M.group=null}}return{opaque:$,transmissive:Z,transparent:W,init:q,push:U,unshift:Y,finish:G,sort:X}}function pY(){let J=new WeakMap;function Q(Z,W){let q=J.get(Z),K;if(q===void 0)K=new zZ,J.set(Z,[K]);else if(W>=q.length)K=new zZ,q.push(K);else K=q[W];return K}function $(){J=new WeakMap}return{get:Q,dispose:$}}function mY(){let J={};return{get:function(Q){if(J[Q.id]!==void 0)return J[Q.id];let $;switch(Q.type){case"SunLight":case"DirectionalLight":$={direction:new u,color:new r8};break;case"SpotLight":$={position:new u,direction:new u,color:new r8,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":$={position:new u,color:new r8,distance:0,decay:0};break;case"HemisphereLight":$={direction:new u,skyColor:new r8,groundColor:new r8};break;case"RectAreaLight":$={color:new r8,position:new u,halfWidth:new u,halfHeight:new u};break}return J[Q.id]=$,$}}}function lY(){let J={};return{get:function(Q){if(J[Q.id]!==void 0)return J[Q.id];let $;switch(Q.type){case"SunLight":case"DirectionalLight":$={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new L8};break;case"SpotLight":$={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new L8};break;case"PointLight":$={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new L8,shadowCameraNear:1,shadowCameraFar:1000};break}return J[Q.id]=$,$}}}var dY=0;function uY(J,Q){return(Q.castShadow?2:0)-(J.castShadow?2:0)+(Q.map?1:0)-(J.map?1:0)}function cY(J){let Q=new mY,$=lY(),Z={version:0,hash:{sunLength:-1,directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numSunShadows:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],sun:[],sunShadow:[],sunShadowMap:[],sunShadowMatrix:[],sunShadowCascade:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let Y=0;Y<9;Y++)Z.probe.push(new u);let W=new u,q=new G6,K=new G6;function H(Y){let X=0,G=0,N=0;for(let J8=0;J8<9;J8++)Z.probe[J8].set(0,0,0);let F=0,M=0,L=0,E=0,O=0,_=0,V=0,B=0,w=0,y=0,D=0,z=0,m=0,t=0;Y.sort(uY);for(let J8=0,E8=Y.length;J8<E8;J8++){let T=Y[J8],H8=T.color,e=T.intensity,S=T.distance,B8=null;if(T.shadow&&T.shadow.map)if(T.shadow.map.texture.format===t7)B8=T.shadow.map.texture;else B8=T.shadow.map.depthTexture||T.shadow.map.texture;if(T.isAmbientLight)X+=H8.r*e,G+=H8.g*e,N+=H8.b*e;else if(T.isLightProbe){for(let i=0;i<9;i++)Z.probe[i].addScaledVector(T.sh.coefficients[i],e);t++}else if(T.isSunLight){let i=Q.get(T);if(i.color.copy(T.color).multiplyScalar(T.intensity),T.castShadow){let X8=T.shadow,V8=$.get(T);V8.shadowIntensity=X8.intensity,V8.shadowBias=X8.bias,V8.shadowNormalBias=X8.normalBias,V8.shadowRadius=X8.radius,V8.shadowMapSize.copy(X8.mapSize).multiply(X8.getFrameExtents()),Z.sunShadow[M]=V8,Z.sunShadowMap[M]=B8;let v8=X8.getViewportCount();for(let U8=0;U8<v8;U8++)Z.sunShadowMatrix[L+U8]=X8.getMatrix(U8),Z.sunShadowCascade[L+U8]=X8._cascadeData[U8];L+=v8,M++}Z.sun[F]=i,F++}else if(T.isDirectionalLight){let i=Q.get(T);if(i.color.copy(T.color).multiplyScalar(T.intensity),T.castShadow){let X8=T.shadow,V8=$.get(T);V8.shadowIntensity=X8.intensity,V8.shadowBias=X8.bias,V8.shadowNormalBias=X8.normalBias,V8.shadowRadius=X8.radius,V8.shadowMapSize=X8.mapSize,Z.directionalShadow[E]=V8,Z.directionalShadowMap[E]=B8,Z.directionalShadowMatrix[E]=T.shadow.matrix,w++}Z.directional[E]=i,E++}else if(T.isSpotLight){let i=Q.get(T);i.position.setFromMatrixPosition(T.matrixWorld),i.color.copy(H8).multiplyScalar(e),i.distance=S,i.coneCos=Math.cos(T.angle),i.penumbraCos=Math.cos(T.angle*(1-T.penumbra)),i.decay=T.decay,Z.spot[_]=i;let X8=T.shadow;if(T.map){if(Z.spotLightMap[z]=T.map,z++,X8.updateMatrices(T),T.castShadow)m++}if(Z.spotLightMatrix[_]=X8.matrix,T.castShadow){let V8=$.get(T);V8.shadowIntensity=X8.intensity,V8.shadowBias=X8.bias,V8.shadowNormalBias=X8.normalBias,V8.shadowRadius=X8.radius,V8.shadowMapSize=X8.mapSize,Z.spotShadow[_]=V8,Z.spotShadowMap[_]=B8,D++}_++}else if(T.isRectAreaLight){let i=Q.get(T);i.color.copy(H8).multiplyScalar(e),i.halfWidth.set(T.width*0.5,0,0),i.halfHeight.set(0,T.height*0.5,0),Z.rectArea[V]=i,V++}else if(T.isPointLight){let i=Q.get(T);if(i.color.copy(T.color).multiplyScalar(T.intensity),i.distance=T.distance,i.decay=T.decay,T.castShadow){let X8=T.shadow,V8=$.get(T);V8.shadowIntensity=X8.intensity,V8.shadowBias=X8.bias,V8.shadowNormalBias=X8.normalBias,V8.shadowRadius=X8.radius,V8.shadowMapSize=X8.mapSize,V8.shadowCameraNear=X8.camera.near,V8.shadowCameraFar=X8.camera.far,Z.pointShadow[O]=V8,Z.pointShadowMap[O]=B8,Z.pointShadowMatrix[O]=T.shadow.matrix,y++}Z.point[O]=i,O++}else if(T.isHemisphereLight){let i=Q.get(T);i.skyColor.copy(T.color).multiplyScalar(e),i.groundColor.copy(T.groundColor).multiplyScalar(e),Z.hemi[B]=i,B++}}if(V>0)if(J.has("OES_texture_float_linear")===!0)Z.rectAreaLTC1=h8.LTC_FLOAT_1,Z.rectAreaLTC2=h8.LTC_FLOAT_2;else Z.rectAreaLTC1=h8.LTC_HALF_1,Z.rectAreaLTC2=h8.LTC_HALF_2;Z.ambient[0]=X,Z.ambient[1]=G,Z.ambient[2]=N;let v=Z.hash;if(v.sunLength!==F||v.directionalLength!==E||v.pointLength!==O||v.spotLength!==_||v.rectAreaLength!==V||v.hemiLength!==B||v.numSunShadows!==M||v.numDirectionalShadows!==w||v.numPointShadows!==y||v.numSpotShadows!==D||v.numSpotMaps!==z||v.numLightProbes!==t)Z.sun.length=F,Z.directional.length=E,Z.spot.length=_,Z.rectArea.length=V,Z.point.length=O,Z.hemi.length=B,Z.sunShadow.length=M,Z.sunShadowMap.length=M,Z.sunShadowMatrix.length=L,Z.sunShadowCascade.length=L,Z.directionalShadow.length=w,Z.directionalShadowMap.length=w,Z.directionalShadowMatrix.length=w,Z.pointShadow.length=y,Z.pointShadowMap.length=y,Z.pointShadowMatrix.length=y,Z.spotShadow.length=D,Z.spotShadowMap.length=D,Z.spotLightMatrix.length=D+z-m,Z.spotLightMap.length=z,Z.numSpotLightShadowsWithMaps=m,Z.numLightProbes=t,v.sunLength=F,v.directionalLength=E,v.pointLength=O,v.spotLength=_,v.rectAreaLength=V,v.hemiLength=B,v.numSunShadows=M,v.numDirectionalShadows=w,v.numPointShadows=y,v.numSpotShadows=D,v.numSpotMaps=z,v.numLightProbes=t,Z.version=dY++}function U(Y,X){let G=0,N=0,F=0,M=0,L=0,E=0,O=X.matrixWorldInverse;for(let _=0,V=Y.length;_<V;_++){let B=Y[_];if(B.isSunLight){let w=Z.sun[G];w.direction.setFromMatrixPosition(B.matrixWorld),w.direction.transformDirection(O),G++}else if(B.isDirectionalLight){let w=Z.directional[N];w.direction.setFromMatrixPosition(B.matrixWorld),W.setFromMatrixPosition(B.target.matrixWorld),w.direction.sub(W),w.direction.transformDirection(O),N++}else if(B.isSpotLight){let w=Z.spot[M];w.position.setFromMatrixPosition(B.matrixWorld),w.position.applyMatrix4(O),w.direction.setFromMatrixPosition(B.matrixWorld),W.setFromMatrixPosition(B.target.matrixWorld),w.direction.sub(W),w.direction.transformDirection(O),M++}else if(B.isRectAreaLight){let w=Z.rectArea[L];w.position.setFromMatrixPosition(B.matrixWorld),w.position.applyMatrix4(O),K.identity(),q.copy(B.matrixWorld),q.premultiply(O),K.extractRotation(q),w.halfWidth.set(B.width*0.5,0,0),w.halfHeight.set(0,B.height*0.5,0),w.halfWidth.applyMatrix4(K),w.halfHeight.applyMatrix4(K),L++}else if(B.isPointLight){let w=Z.point[F];w.position.setFromMatrixPosition(B.matrixWorld),w.position.applyMatrix4(O),F++}else if(B.isHemisphereLight){let w=Z.hemi[E];w.direction.setFromMatrixPosition(B.matrixWorld),w.direction.transformDirection(O),E++}}}return{setup:H,setupView:U,state:Z}}function VZ(J){let Q=new cY(J),$=[],Z=[],W=[];function q(G){X.camera=G,$.length=0,Z.length=0,W.length=0}function K(G){if(G.isLightProbeGrid)W.push(G);else $.push(G)}function H(G){Z.push(G)}function U(){Q.setup($),W.sort((G,N)=>G.priority-N.priority||G.id-N.id)}function Y(G){Q.setupView($,G)}let X={lightsArray:$,shadowsArray:Z,lightProbeGridArray:W,camera:null,lights:Q,transmissionRenderTarget:{},textureUnits:0};return{init:q,state:X,setupLights:U,setupLightsView:Y,pushLight:K,pushShadow:H}}function nY(J){let Q=new WeakMap;function $(W,q=0){let K=Q.get(W),H;if(K===void 0)H=new VZ(J),Q.set(W,[H]);else if(q>=K.length)H=new VZ(J),K.push(H);else H=K[q];return H}function Z(){Q=new WeakMap}return{get:$,dispose:Z}}var sY=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,iY=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ).rg;
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ).r;
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( max( 0.0, squared_mean - mean * mean ) );
	gl_FragColor = vec4( mean, std_dev, 0.0, 1.0 );
}`,oY=[new u(1,0,0),new u(-1,0,0),new u(0,1,0),new u(0,-1,0),new u(0,0,1),new u(0,0,-1)],aY=[new u(0,-1,0),new u(0,-1,0),new u(0,0,1),new u(0,0,-1),new u(0,-1,0),new u(0,-1,0)],IZ=new G6,R0=new u,oJ=new u;function rY(J,Q,$){let Z=new i7,W=new L8,q=new L8,K=new R6,H=new yJ,U=new vJ,Y={},X=$.maxTextureSize,G={[w9]:f6,[f6]:w9,[m6]:m6},N=new Z7({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new L8},radius:{value:4}},vertexShader:sY,fragmentShader:iY}),F=N.clone();F.defines.HORIZONTAL_PASS=1;let M=new $7;M.setAttribute("position",new U7(new Float32Array([-1,-1,0.5,3,-1,0.5,-1,3,0.5]),3));let L=new M6(M,N),E=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=q0;let O=this.type;this.render=function(y,D,z){if(E.enabled===!1)return;if(E.autoUpdate===!1&&E.needsUpdate===!1)return;if(y.length===0)return;if(this.type===sQ)t8("WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead."),this.type=q0;let m=J.getRenderTarget(),t=J.getActiveCubeFace(),v=J.getActiveMipmapLevel(),J8=J.state;if(J8.setBlending(a7),J8.buffers.depth.getReversed()===!0)J8.buffers.color.setClear(0,0,0,0);else J8.buffers.color.setClear(1,1,1,1);J8.buffers.depth.setTest(!0),J8.setScissorTest(!1);let E8=O!==this.type;if(E8)D.traverse(function(T){if(T.material)if(Array.isArray(T.material))T.material.forEach((H8)=>H8.needsUpdate=!0);else T.material.needsUpdate=!0});for(let T=0,H8=y.length;T<H8;T++){let e=y[T],S=e.shadow;if(S===void 0){t8("WebGLShadowMap:",e,"has no shadow.");continue}if(S.autoUpdate===!1&&S.needsUpdate===!1)continue;W.copy(S.mapSize);let B8=S.getFrameExtents();if(W.multiply(B8),q.copy(S.mapSize),W.x>X||W.y>X){if(W.x>X)q.x=Math.floor(X/B8.x),W.x=q.x*B8.x,S.mapSize.x=q.x;if(W.y>X)q.y=Math.floor(X/B8.y),W.y=q.y*B8.y,S.mapSize.y=q.y}let i=J.state.buffers.depth.getReversed();if(S.camera._reversedDepth=i,S.map===null||E8===!0){if(S.map!==null){if(S.map.depthTexture!==null)S.map.depthTexture.dispose(),S.map.depthTexture=null;S.map.dispose()}if(this.type===P9){if(e.isPointLight){t8("WebGLShadowMap: VSM shadow maps are not supported for PointLights. Use PCF or BasicShadowMap instead.");continue}S.map=new c6(W.x,W.y,{format:t7,type:G7,minFilter:u6,magFilter:u6,generateMipmaps:!1}),S.map.texture.name=e.name+".shadowMap",S.map.depthTexture=new x7(W.x,W.y,I7),S.map.depthTexture.name=e.name+".shadowMapDepth",S.map.depthTexture.format=y9,S.map.depthTexture.compareFunction=null,S.map.depthTexture.minFilter=e6,S.map.depthTexture.magFilter=e6}else{if(e.isPointLight)S.map=new v5(W.x),S.map.depthTexture=new R5(W.x,f7);else S.map=new c6(W.x,W.y),S.map.depthTexture=new x7(W.x,W.y,f7);if(S.map.depthTexture.name=e.name+".shadowMap",S.map.depthTexture.format=y9,this.type===q0)S.map.depthTexture.compareFunction=i?NJ:GJ,S.map.depthTexture.minFilter=u6,S.map.depthTexture.magFilter=u6;else S.map.depthTexture.compareFunction=null,S.map.depthTexture.minFilter=e6,S.map.depthTexture.magFilter=e6}S.camera.updateProjectionMatrix()}if(S.map.isWebGLCubeRenderTarget!==!0&&(S.map.width!==W.x||S.map.height!==W.y))S.map.setSize(W.x,W.y);let X8=S.map.isWebGLCubeRenderTarget?6:S.getViewportCount();if(e.isPointLight!==!0)S.updateMatrices(e,z);let V8=(S.camera.layers.mask&4294967294)!==0?S.camera.layers:z.layers;for(let v8=0;v8<X8;v8++){let U8=S.getCamera(v8);if(e.isPointLight){let{camera:M8,matrix:b8}=S,n=e.distance||M8.far;if(n!==M8.far)M8.far=n,M8.updateProjectionMatrix();R0.setFromMatrixPosition(e.matrixWorld),M8.position.copy(R0),oJ.copy(M8.position),oJ.add(oY[v8]),M8.up.copy(aY[v8]),M8.lookAt(oJ),M8.updateMatrixWorld(),b8.makeTranslation(-R0.x,-R0.y,-R0.z),IZ.multiplyMatrices(M8.projectionMatrix,M8.matrixWorldInverse),S._frustum.setFromProjectionMatrix(IZ,M8.coordinateSystem,M8.reversedDepth)}if(S.map.isWebGLCubeRenderTarget)J.setRenderTarget(S.map,v8),J.clear();else{if(v8===0)J.setRenderTarget(S.map),J.clear();let M8=S.getViewport(v8);K.set(q.x*M8.x,q.y*M8.y,q.x*M8.z,q.y*M8.w),J8.viewport(K)}Z=S.getFrustum(v8),B(D,z,U8,e,V8,this.type)}if(S.isPointLightShadow!==!0&&this.type===P9)_(S,z);S.needsUpdate=!1}O=this.type,E.needsUpdate=!1,J.setRenderTarget(m,t,v)};function _(y,D){let z=Q.update(L);if(N.defines.VSM_SAMPLES!==y.blurSamples)N.defines.VSM_SAMPLES=y.blurSamples,F.defines.VSM_SAMPLES=y.blurSamples,N.needsUpdate=!0,F.needsUpdate=!0;if(y.mapPass===null)y.mapPass=new c6(W.x,W.y,{format:t7,type:G7});else if(y.mapPass.width!==y.map.width||y.mapPass.height!==y.map.height)y.mapPass.setSize(y.map.width,y.map.height);N.uniforms.shadow_pass.value=y.map.depthTexture,N.uniforms.resolution.value.set(y.map.width,y.map.height),N.uniforms.radius.value=y.radius,J.setRenderTarget(y.mapPass),J.clear(),J.renderBufferDirect(D,null,z,N,L,null),F.uniforms.shadow_pass.value=y.mapPass.texture,F.uniforms.resolution.value.set(y.map.width,y.map.height),F.uniforms.radius.value=y.radius,J.setRenderTarget(y.map),J.clear(),J.renderBufferDirect(D,null,z,F,L,null)}function V(y,D,z,m){let t=null,v=z.isPointLight===!0?y.customDistanceMaterial:y.customDepthMaterial;if(v!==void 0)t=v;else if(t=z.isPointLight===!0?U:H,J.localClippingEnabled&&D.clipShadows===!0&&Array.isArray(D.clippingPlanes)&&D.clippingPlanes.length!==0||D.displacementMap&&D.displacementScale!==0||D.alphaMap&&D.alphaTest>0||D.map&&D.alphaTest>0||D.alphaToCoverage===!0){let J8=t.uuid,E8=D.uuid,T=Y[J8];if(T===void 0)T={},Y[J8]=T;let H8=T[E8];if(H8===void 0)H8=t.clone(),T[E8]=H8,D.addEventListener("dispose",w);t=H8}if(t.visible=D.visible,t.wireframe=D.wireframe,m===P9)t.side=D.shadowSide!==null?D.shadowSide:D.side;else t.side=D.shadowSide!==null?D.shadowSide:G[D.side];if(t.alphaMap=D.alphaMap,t.alphaTest=D.alphaToCoverage===!0?0.5:D.alphaTest,t.map=D.map,t.clipShadows=D.clipShadows,t.clippingPlanes=D.clippingPlanes,t.clipIntersection=D.clipIntersection,t.displacementMap=D.displacementMap,t.displacementScale=D.displacementScale,t.displacementBias=D.displacementBias,t.wireframeLinewidth=D.wireframeLinewidth,t.linewidth=D.linewidth,z.isPointLight===!0&&t.isMeshDistanceMaterial===!0){let J8=J.properties.get(t);J8.light=z}return t}function B(y,D,z,m,t,v){if(y.visible===!1)return;if(y.layers.test(t)&&(y.isMesh||y.isLine||y.isPoints)){if((y.castShadow||y.receiveShadow&&v===P9)&&(!y.frustumCulled||y.intersectsFrustum(Z))){y.modelViewMatrix.multiplyMatrices(z.matrixWorldInverse,y.matrixWorld);let T=Q.update(y),H8=y.material;if(Array.isArray(H8)){let e=T.groups;for(let S=0,B8=e.length;S<B8;S++){let i=e[S],X8=H8[i.materialIndex];if(X8&&X8.visible){let V8=V(y,X8,m,v);y.onBeforeShadow(J,y,D,z,T,V8,i),J.renderBufferDirect(z,null,T,V8,y,i),y.onAfterShadow(J,y,D,z,T,V8,i)}}}else if(H8.visible){let e=V(y,H8,m,v);y.onBeforeShadow(J,y,D,z,T,e,null),J.renderBufferDirect(z,null,T,e,y,null),y.onAfterShadow(J,y,D,z,T,e,null)}}}let E8=y.children;for(let T=0,H8=E8.length;T<H8;T++)B(E8[T],D,z,m,t,v)}function w(y){y.target.removeEventListener("dispose",w);for(let z in Y){let m=Y[z],t=y.target.uuid;if(t in m)m[t].dispose(),delete m[t]}}}function tY(J,Q){function $(){let b=!1,F8=new R6,G8=null,_8=new R6(0,0,0,0);return{setMask:function(C8){if(G8!==C8&&!b)J.colorMask(C8,C8,C8,C8),G8=C8},setLocked:function(C8){b=C8},setClear:function(C8,y8,o8,s8,x8){if(x8===!0)C8*=s8,y8*=s8,o8*=s8;if(F8.set(C8,y8,o8,s8),_8.equals(F8)===!1)J.clearColor(C8,y8,o8,s8),_8.copy(F8)},reset:function(){b=!1,G8=null,_8.set(-1,0,0,0)}}}function Z(){let b=!1,F8=!1,G8=null,_8=null,C8=null;return{setReversed:function(y8){if(F8!==y8){let o8=Q.get("EXT_clip_control");if(y8)o8.clipControlEXT(o8.LOWER_LEFT_EXT,o8.ZERO_TO_ONE_EXT);else o8.clipControlEXT(o8.LOWER_LEFT_EXT,o8.NEGATIVE_ONE_TO_ONE_EXT);F8=y8;let s8=C8;C8=null,this.setClear(s8)}},getReversed:function(){return F8},setTest:function(y8){if(y8)P(J.DEPTH_TEST);else C(J.DEPTH_TEST)},setMask:function(y8){if(G8!==y8&&!b)J.depthMask(y8),G8=y8},setFunc:function(y8){if(F8)y8=m$[y8];if(_8!==y8){switch(y8){case F$:J.depthFunc(J.NEVER);break;case D$:J.depthFunc(J.ALWAYS);break;case O$:J.depthFunc(J.LESS);break;case k1:J.depthFunc(J.LEQUAL);break;case R$:J.depthFunc(J.EQUAL);break;case M$:J.depthFunc(J.GEQUAL);break;case k$:J.depthFunc(J.GREATER);break;case L$:J.depthFunc(J.NOTEQUAL);break;default:J.depthFunc(J.LEQUAL)}_8=y8}},setLocked:function(y8){b=y8},setClear:function(y8){if(C8!==y8){if(C8=y8,F8)y8=1-y8;J.clearDepth(y8)}},reset:function(){b=!1,G8=null,_8=null,C8=null,F8=!1}}}function W(){let b=!1,F8=null,G8=null,_8=null,C8=null,y8=null,o8=null,s8=null,x8=null;return{setTest:function(a8){if(!b)if(a8)P(J.STENCIL_TEST);else C(J.STENCIL_TEST)},setMask:function(a8){if(F8!==a8&&!b)J.stencilMask(a8),F8=a8},setFunc:function(a8,Q6,g8){if(G8!==a8||_8!==Q6||C8!==g8)J.stencilFunc(a8,Q6,g8),G8=a8,_8=Q6,C8=g8},setOp:function(a8,Q6,g8){if(y8!==a8||o8!==Q6||s8!==g8)J.stencilOp(a8,Q6,g8),y8=a8,o8=Q6,s8=g8},setLocked:function(a8){b=a8},setClear:function(a8){if(x8!==a8)J.clearStencil(a8),x8=a8},reset:function(){b=!1,F8=null,G8=null,_8=null,C8=null,y8=null,o8=null,s8=null,x8=null}}}let q=new $,K=new Z,H=new W,U={},Y=new WeakMap,X={},G={},N={},F=new WeakMap,M=[],L=null,E=!1,O=null,_=null,V=null,B=null,w=null,y=null,D=null,z=new r8(0,0,0),m=0,t=!1,v=null,J8=null,E8=null,T=null,H8=null,e=J.getParameter(J.MAX_COMBINED_TEXTURE_IMAGE_UNITS),S=!1,B8=0,i=J.getParameter(J.VERSION);if(i.indexOf("WebGL")!==-1)B8=parseFloat(/^WebGL (\d)/.exec(i)[1]),S=B8>=1;else if(i.indexOf("OpenGL ES")!==-1)B8=parseFloat(/^OpenGL ES (\d)/.exec(i)[1]),S=B8>=2;let X8=null,V8={},v8=J.getParameter(J.SCISSOR_BOX),U8=J.getParameter(J.VIEWPORT),M8=new R6().fromArray(v8),b8=new R6().fromArray(U8);function n(b,F8,G8,_8){let C8=new Uint8Array(4),y8=J.createTexture();J.bindTexture(b,y8),J.texParameteri(b,J.TEXTURE_MIN_FILTER,J.NEAREST),J.texParameteri(b,J.TEXTURE_MAG_FILTER,J.NEAREST);for(let o8=0;o8<G8;o8++)if(b===J.TEXTURE_3D||b===J.TEXTURE_2D_ARRAY)J.texImage3D(F8,0,J.RGBA,1,1,_8,0,J.RGBA,J.UNSIGNED_BYTE,C8);else J.texImage2D(F8+o8,0,J.RGBA,1,1,0,J.RGBA,J.UNSIGNED_BYTE,C8);return y8}let d={};d[J.TEXTURE_2D]=n(J.TEXTURE_2D,J.TEXTURE_2D,1),d[J.TEXTURE_CUBE_MAP]=n(J.TEXTURE_CUBE_MAP,J.TEXTURE_CUBE_MAP_POSITIVE_X,6),d[J.TEXTURE_2D_ARRAY]=n(J.TEXTURE_2D_ARRAY,J.TEXTURE_2D_ARRAY,1,1),d[J.TEXTURE_3D]=n(J.TEXTURE_3D,J.TEXTURE_3D,1,1),q.setClear(0,0,0,1),K.setClear(1),H.setClear(0),P(J.DEPTH_TEST),K.setFunc(k1),s(!1),q8(D1),P(J.CULL_FACE),j(a7);function P(b){if(X[b]!==!0)J.enable(b),X[b]=!0}function C(b){if(X[b]!==!1)J.disable(b),X[b]=!1}function g(b,F8){if(N[b]!==F8){if(J.bindFramebuffer(b,F8),N[b]=F8,b===J.DRAW_FRAMEBUFFER)N[J.FRAMEBUFFER]=F8;if(b===J.FRAMEBUFFER)N[J.DRAW_FRAMEBUFFER]=F8;return!0}return!1}function K8(b,F8){let G8=M,_8=!1;if(b){if(G8=F.get(F8),G8===void 0)G8=[],F.set(F8,G8);let C8=b.textures;if(G8.length!==C8.length||G8[0]!==J.COLOR_ATTACHMENT0){for(let y8=0,o8=C8.length;y8<o8;y8++)G8[y8]=J.COLOR_ATTACHMENT0+y8;G8.length=C8.length,_8=!0}}else if(G8[0]!==J.BACK)G8[0]=J.BACK,_8=!0;if(_8)J.drawBuffers(G8)}function D8(b){if(L!==b)return J.useProgram(b),L=b,!0;return!1}let A={[T9]:J.FUNC_ADD,[oQ]:J.FUNC_SUBTRACT,[aQ]:J.FUNC_REVERSE_SUBTRACT};A[rQ]=J.MIN,A[tQ]=J.MAX;let l={[eQ]:J.ZERO,[J$]:J.ONE,[Q$]:J.SRC_COLOR,[Z$]:J.SRC_ALPHA,[Y$]:J.SRC_ALPHA_SATURATE,[H$]:J.DST_COLOR,[q$]:J.DST_ALPHA,[$$]:J.ONE_MINUS_SRC_COLOR,[W$]:J.ONE_MINUS_SRC_ALPHA,[U$]:J.ONE_MINUS_DST_COLOR,[K$]:J.ONE_MINUS_DST_ALPHA,[X$]:J.CONSTANT_COLOR,[G$]:J.ONE_MINUS_CONSTANT_COLOR,[N$]:J.CONSTANT_ALPHA,[E$]:J.ONE_MINUS_CONSTANT_ALPHA};function j(b,F8,G8,_8,C8,y8,o8,s8,x8,a8){if(b===a7){if(E===!0)C(J.BLEND),E=!1;return}if(E===!1)P(J.BLEND),E=!0;if(b!==iQ){if(b!==O||a8!==t){if(_!==T9||w!==T9)J.blendEquation(J.FUNC_ADD),_=T9,w=T9;if(a8)switch(b){case K0:J.blendFuncSeparate(J.ONE,J.ONE_MINUS_SRC_ALPHA,J.ONE,J.ONE_MINUS_SRC_ALPHA);break;case O1:J.blendFunc(J.ONE,J.ONE);break;case R1:J.blendFuncSeparate(J.ZERO,J.ONE_MINUS_SRC_COLOR,J.ZERO,J.ONE);break;case M1:J.blendFuncSeparate(J.DST_COLOR,J.ONE_MINUS_SRC_ALPHA,J.ZERO,J.ONE);break;default:e8("WebGLState: Invalid blending: ",b);break}else switch(b){case K0:J.blendFuncSeparate(J.SRC_ALPHA,J.ONE_MINUS_SRC_ALPHA,J.ONE,J.ONE_MINUS_SRC_ALPHA);break;case O1:J.blendFuncSeparate(J.SRC_ALPHA,J.ONE,J.ONE,J.ONE);break;case R1:e8("WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case M1:e8("WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:e8("WebGLState: Invalid blending: ",b);break}V=null,B=null,y=null,D=null,z.set(0,0,0),m=0,O=b,t=a8}return}if(C8=C8||F8,y8=y8||G8,o8=o8||_8,F8!==_||C8!==w)J.blendEquationSeparate(A[F8],A[C8]),_=F8,w=C8;if(G8!==V||_8!==B||y8!==y||o8!==D)J.blendFuncSeparate(l[G8],l[_8],l[y8],l[o8]),V=G8,B=_8,y=y8,D=o8;if(s8.equals(z)===!1||x8!==m)J.blendColor(s8.r,s8.g,s8.b,x8),z.copy(s8),m=x8;O=b,t=!1}function o(b,F8){b.side===m6?C(J.CULL_FACE):P(J.CULL_FACE);let G8=b.side===f6;if(F8)G8=!G8;s(G8),b.blending===K0&&b.transparent===!1?j(a7):j(b.blending,b.blendEquation,b.blendSrc,b.blendDst,b.blendEquationAlpha,b.blendSrcAlpha,b.blendDstAlpha,b.blendColor,b.blendAlpha,b.premultipliedAlpha),K.setFunc(b.depthFunc),K.setTest(b.depthTest),K.setMask(b.depthWrite),q.setMask(b.colorWrite);let _8=b.stencilWrite;if(H.setTest(_8),_8)H.setMask(b.stencilWriteMask),H.setFunc(b.stencilFunc,b.stencilRef,b.stencilFuncMask),H.setOp(b.stencilFail,b.stencilZFail,b.stencilZPass);h(b.polygonOffset,b.polygonOffsetFactor,b.polygonOffsetUnits),b.alphaToCoverage===!0?P(J.SAMPLE_ALPHA_TO_COVERAGE):C(J.SAMPLE_ALPHA_TO_COVERAGE)}function s(b){if(v!==b){if(b)J.frontFace(J.CW);else J.frontFace(J.CCW);v=b}}function q8(b){if(b!==cQ){if(P(J.CULL_FACE),b!==J8)if(b===D1)J.cullFace(J.BACK);else if(b===nQ)J.cullFace(J.FRONT);else J.cullFace(J.FRONT_AND_BACK)}else C(J.CULL_FACE);J8=b}function N8(b){if(b!==E8){if(S)J.lineWidth(b);E8=b}}function h(b,F8,G8){if(b){if(P(J.POLYGON_OFFSET_FILL),T!==F8||H8!==G8){if(T=F8,H8=G8,K.getReversed())F8=-F8,G8=-G8;J.polygonOffset(F8,G8)}}else C(J.POLYGON_OFFSET_FILL)}function x(b){if(b)P(J.SCISSOR_TEST);else C(J.SCISSOR_TEST)}function k8(b){if(b===void 0)b=J.TEXTURE0+e-1;if(X8!==b)J.activeTexture(b),X8=b}function f(b,F8,G8){if(G8===void 0)if(X8===null)G8=J.TEXTURE0+e-1;else G8=X8;let _8=V8[G8];if(_8===void 0)_8={type:void 0,texture:void 0},V8[G8]=_8;if(_8.type!==b||_8.texture!==F8){if(X8!==G8)J.activeTexture(G8),X8=G8;J.bindTexture(b,F8||d[b]),_8.type=b,_8.texture=F8}}function Y8(){let b=V8[X8];if(b!==void 0&&b.type!==void 0)J.bindTexture(b.type,null),b.type=void 0,b.texture=void 0}function Z8(){try{J.compressedTexImage2D(...arguments)}catch(b){e8("WebGLState:",b)}}function A8(){try{J.compressedTexImage3D(...arguments)}catch(b){e8("WebGLState:",b)}}function Q8(){try{J.texSubImage2D(...arguments)}catch(b){e8("WebGLState:",b)}}function m8(){try{J.texSubImage3D(...arguments)}catch(b){e8("WebGLState:",b)}}function f8(){try{J.compressedTexSubImage2D(...arguments)}catch(b){e8("WebGLState:",b)}}function j8(){try{J.compressedTexSubImage3D(...arguments)}catch(b){e8("WebGLState:",b)}}function l8(){try{J.texStorage2D(...arguments)}catch(b){e8("WebGLState:",b)}}function I(){try{J.texStorage3D(...arguments)}catch(b){e8("WebGLState:",b)}}function R(){try{J.texImage2D(...arguments)}catch(b){e8("WebGLState:",b)}}function c(){try{J.texImage3D(...arguments)}catch(b){e8("WebGLState:",b)}}function z8(b){if(G[b]!==void 0)return G[b];else return J.getParameter(b)}function R8(b,F8){if(G[b]!==F8)J.pixelStorei(b,F8),G[b]=F8}function I8(b){if(M8.equals(b)===!1)J.scissor(b.x,b.y,b.z,b.w),M8.copy(b)}function P8(b){if(b8.equals(b)===!1)J.viewport(b.x,b.y,b.z,b.w),b8.copy(b)}function W8(b,F8){let G8=Y.get(F8);if(G8===void 0)G8=new WeakMap,Y.set(F8,G8);let _8=G8.get(b);if(_8===void 0)_8=J.getUniformBlockIndex(F8,b.name),J.uniformBlockBinding(F8,_8,_8),G8.set(b,_8)}function O8(b,F8,G8){let C8=Y.get(F8).get(b);if(U[C8]!==G8)J.bindBufferBase(J.UNIFORM_BUFFER,C8,G8),U[C8]=G8}function w8(){J.disable(J.BLEND),J.disable(J.CULL_FACE),J.disable(J.DEPTH_TEST),J.disable(J.POLYGON_OFFSET_FILL),J.disable(J.SCISSOR_TEST),J.disable(J.STENCIL_TEST),J.disable(J.SAMPLE_ALPHA_TO_COVERAGE),J.blendEquation(J.FUNC_ADD),J.blendFunc(J.ONE,J.ZERO),J.blendFuncSeparate(J.ONE,J.ZERO,J.ONE,J.ZERO),J.blendColor(0,0,0,0),J.colorMask(!0,!0,!0,!0),J.clearColor(0,0,0,0),J.depthMask(!0),J.depthFunc(J.LESS),K.setReversed(!1),J.clearDepth(1),J.stencilMask(4294967295),J.stencilFunc(J.ALWAYS,0,4294967295),J.stencilOp(J.KEEP,J.KEEP,J.KEEP),J.clearStencil(0),J.cullFace(J.BACK),J.frontFace(J.CCW),J.polygonOffset(0,0),J.activeTexture(J.TEXTURE0),J.bindFramebuffer(J.FRAMEBUFFER,null),J.bindFramebuffer(J.DRAW_FRAMEBUFFER,null),J.bindFramebuffer(J.READ_FRAMEBUFFER,null),J.useProgram(null),J.lineWidth(1),J.scissor(0,0,J.canvas.width,J.canvas.height),J.viewport(0,0,J.canvas.width,J.canvas.height),J.pixelStorei(J.PACK_ALIGNMENT,4),J.pixelStorei(J.UNPACK_ALIGNMENT,4),J.pixelStorei(J.UNPACK_FLIP_Y_WEBGL,!1),J.pixelStorei(J.UNPACK_PREMULTIPLY_ALPHA_WEBGL,!1),J.pixelStorei(J.UNPACK_COLORSPACE_CONVERSION_WEBGL,J.BROWSER_DEFAULT_WEBGL),J.pixelStorei(J.PACK_ROW_LENGTH,0),J.pixelStorei(J.PACK_SKIP_PIXELS,0),J.pixelStorei(J.PACK_SKIP_ROWS,0),J.pixelStorei(J.UNPACK_ROW_LENGTH,0),J.pixelStorei(J.UNPACK_IMAGE_HEIGHT,0),J.pixelStorei(J.UNPACK_SKIP_PIXELS,0),J.pixelStorei(J.UNPACK_SKIP_ROWS,0),J.pixelStorei(J.UNPACK_SKIP_IMAGES,0),X={},G={},X8=null,V8={},N={},U={},F=new WeakMap,M=[],L=null,E=!1,O=null,_=null,V=null,B=null,w=null,y=null,D=null,z=new r8(0,0,0),m=0,t=!1,v=null,J8=null,E8=null,T=null,H8=null,M8.set(0,0,J.canvas.width,J.canvas.height),b8.set(0,0,J.canvas.width,J.canvas.height),q.reset(),K.reset(),H.reset()}return{buffers:{color:q,depth:K,stencil:H},enable:P,disable:C,bindFramebuffer:g,drawBuffers:K8,useProgram:D8,setBlending:j,setMaterial:o,setFlipSided:s,setCullFace:q8,setLineWidth:N8,setPolygonOffset:h,setScissorTest:x,activeTexture:k8,bindTexture:f,unbindTexture:Y8,compressedTexImage2D:Z8,compressedTexImage3D:A8,texImage2D:R,texImage3D:c,pixelStorei:R8,getParameter:z8,updateUBOMapping:W8,uniformBlockBinding:O8,texStorage2D:l8,texStorage3D:I,texSubImage2D:Q8,texSubImage3D:m8,compressedTexSubImage2D:f8,compressedTexSubImage3D:j8,scissor:I8,viewport:P8,reset:w8}}function eY(J,Q,$,Z,W,q,K){let H=Q.has("WEBGL_multisampled_render_to_texture")?Q.get("WEBGL_multisampled_render_to_texture"):null,U=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),Y=new L8,X=new WeakMap,G=new Set,N,F=new WeakMap,M=new Set,L=new FinalizationRegistry((I)=>M.delete(I)),E=!1;try{E=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch(I){}function O(I,R){return E?new OffscreenCanvas(I,R):Q0("canvas")}function _(I,R,c){let z8=1,R8=l8(I);if(R8.width>c||R8.height>c)z8=c/Math.max(R8.width,R8.height);if(z8<1)if(typeof HTMLImageElement<"u"&&I instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&I instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&I instanceof ImageBitmap||typeof VideoFrame<"u"&&I instanceof VideoFrame){let I8=Math.floor(z8*R8.width),P8=Math.floor(z8*R8.height);if(N===void 0)N=O(I8,P8);let W8=R?O(I8,P8):N;return W8.width=I8,W8.height=P8,W8.getContext("2d").drawImage(I,0,0,I8,P8),t8("WebGLRenderer: Texture has been resized from ("+R8.width+"x"+R8.height+") to ("+I8+"x"+P8+")."),W8}else{if("data"in I)t8("WebGLRenderer: Image in DataTexture is too big ("+R8.width+"x"+R8.height+").");return I}return I}function V(I){return I.generateMipmaps}function B(I){J.generateMipmap(I)}function w(I){if(I.isWebGLCubeRenderTarget)return J.TEXTURE_CUBE_MAP;if(I.isWebGL3DRenderTarget)return J.TEXTURE_3D;if(I.isWebGLArrayRenderTarget||I.isCompressedArrayTexture)return J.TEXTURE_2D_ARRAY;return J.TEXTURE_2D}function y(I,R,c,z8,R8,I8=!1){if(I!==null){if(J[I]!==void 0)return J[I];t8("WebGLRenderer: Attempt to use non-existing WebGL internal format '"+I+"'")}let P8;if(z8){if(P8=Q.get("EXT_texture_norm16"),!P8)t8("WebGLRenderer: Unable to use normalized textures without EXT_texture_norm16 extension")}let W8=R;if(R===J.RED){if(c===J.FLOAT)W8=J.R32F;if(c===J.HALF_FLOAT)W8=J.R16F;if(c===J.UNSIGNED_BYTE)W8=J.R8;if(c===J.UNSIGNED_SHORT&&P8)W8=P8.R16_EXT;if(c===J.SHORT&&P8)W8=P8.R16_SNORM_EXT}if(R===J.RED_INTEGER){if(c===J.UNSIGNED_BYTE)W8=J.R8UI;if(c===J.UNSIGNED_SHORT)W8=J.R16UI;if(c===J.UNSIGNED_INT)W8=J.R32UI;if(c===J.BYTE)W8=J.R8I;if(c===J.SHORT)W8=J.R16I;if(c===J.INT)W8=J.R32I}if(R===J.RG){if(c===J.FLOAT)W8=J.RG32F;if(c===J.HALF_FLOAT)W8=J.RG16F;if(c===J.UNSIGNED_BYTE)W8=J.RG8;if(c===J.UNSIGNED_SHORT&&P8)W8=P8.RG16_EXT;if(c===J.SHORT&&P8)W8=P8.RG16_SNORM_EXT}if(R===J.RG_INTEGER){if(c===J.UNSIGNED_BYTE)W8=J.RG8UI;if(c===J.UNSIGNED_SHORT)W8=J.RG16UI;if(c===J.UNSIGNED_INT)W8=J.RG32UI;if(c===J.BYTE)W8=J.RG8I;if(c===J.SHORT)W8=J.RG16I;if(c===J.INT)W8=J.RG32I}if(R===J.RGB_INTEGER){if(c===J.UNSIGNED_BYTE)W8=J.RGB8UI;if(c===J.UNSIGNED_SHORT)W8=J.RGB16UI;if(c===J.UNSIGNED_INT)W8=J.RGB32UI;if(c===J.BYTE)W8=J.RGB8I;if(c===J.SHORT)W8=J.RGB16I;if(c===J.INT)W8=J.RGB32I}if(R===J.RGBA_INTEGER){if(c===J.UNSIGNED_BYTE)W8=J.RGBA8UI;if(c===J.UNSIGNED_SHORT)W8=J.RGBA16UI;if(c===J.UNSIGNED_INT)W8=J.RGBA32UI;if(c===J.BYTE)W8=J.RGBA8I;if(c===J.SHORT)W8=J.RGBA16I;if(c===J.INT)W8=J.RGBA32I}if(R===J.RGB){if(c===J.UNSIGNED_SHORT&&P8)W8=P8.RGB16_EXT;if(c===J.SHORT&&P8)W8=P8.RGB16_SNORM_EXT;if(c===J.UNSIGNED_INT_5_9_9_9_REV)W8=J.RGB9_E5;if(c===J.UNSIGNED_INT_10F_11F_11F_REV)W8=J.R11F_G11F_B10F}if(R===J.RGBA){let O8=I8?XJ:K6.getTransfer(R8);if(c===J.FLOAT)W8=J.RGBA32F;if(c===J.HALF_FLOAT)W8=J.RGBA16F;if(c===J.UNSIGNED_BYTE)W8=O8===E6?J.SRGB8_ALPHA8:J.RGBA8;if(c===J.UNSIGNED_SHORT&&P8)W8=P8.RGBA16_EXT;if(c===J.SHORT&&P8)W8=P8.RGBA16_SNORM_EXT;if(c===J.UNSIGNED_SHORT_4_4_4_4)W8=J.RGBA4;if(c===J.UNSIGNED_SHORT_5_5_5_1)W8=J.RGB5_A1}if(W8===J.R16F||W8===J.R32F||W8===J.RG16F||W8===J.RG32F||W8===J.RGBA16F||W8===J.RGBA32F)Q.get("EXT_color_buffer_float");return W8}function D(I,R){let c;if(I){if(R===null||R===f7||R===r7)c=J.DEPTH24_STENCIL8;else if(R===I7)c=J.DEPTH32F_STENCIL8;else if(R===X0)c=J.DEPTH24_STENCIL8,t8("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")}else if(R===null||R===f7||R===r7)c=J.DEPTH_COMPONENT24;else if(R===I7)c=J.DEPTH_COMPONENT32F;else if(R===X0)c=J.DEPTH_COMPONENT16;return c}function z(I,R){if(V(I)===!0||I.isFramebufferTexture&&I.minFilter!==e6&&I.minFilter!==u6)return Math.log2(Math.max(R.width,R.height))+1;else if(I.mipmaps.length>0)return I.mipmaps.length;else if(I.isCompressedTexture&&Array.isArray(I.image))return R.mipmaps.length;else return 1}function m(I){let R=new WeakRef(I);Z.get(I).__ref=R,M.add(R),L.register(I,R,R)}function t(I){let R=Z.get(I).__ref;if(R===void 0)return;M.delete(R),L.unregister(R)}function v(I){E8(I.target)}function J8(I){T(I.target)}function E8(I){if(I.removeEventListener("dispose",v),t(I),e(I),I.isVideoTexture)X.delete(I);if(I.isHTMLTexture)G.delete(I)}function T(I){I.removeEventListener("dispose",J8),t(I),B8(I)}function H8(){for(let I of M){let R=I.deref();if(R===void 0)continue;if(R.isRenderTarget===!0)T(R);else E8(R)}M.clear(),G.clear()}function e(I){let R=Z.get(I);if(R.__webglInit===void 0)return;let c=I.source,z8=F.get(c);if(z8){let R8=z8[R.__cacheKey];if(R8.usedTimes--,R8.usedTimes===0)S(I);if(Object.keys(z8).length===0)F.delete(c)}Z.remove(I)}function S(I){let R=Z.get(I);J.deleteTexture(R.__webglTexture);let c=I.source,z8=F.get(c);delete z8[R.__cacheKey],K.memory.textures--}function B8(I){let R=Z.get(I);if(R.__depthDisposeCallback)R.__depthDisposeCallback();let c=I.depthTexture;if(c&&c.renderTarget===I)E8(c);if(I.isWebGLCubeRenderTarget)for(let R8=0;R8<6;R8++){if(Array.isArray(R.__webglFramebuffer[R8]))for(let I8=0;I8<R.__webglFramebuffer[R8].length;I8++)J.deleteFramebuffer(R.__webglFramebuffer[R8][I8]);else J.deleteFramebuffer(R.__webglFramebuffer[R8]);if(R.__webglDepthbuffer)J.deleteRenderbuffer(R.__webglDepthbuffer[R8])}else{if(Array.isArray(R.__webglFramebuffer))for(let R8=0;R8<R.__webglFramebuffer.length;R8++)J.deleteFramebuffer(R.__webglFramebuffer[R8]);else J.deleteFramebuffer(R.__webglFramebuffer);if(R.__webglDepthbuffer)J.deleteRenderbuffer(R.__webglDepthbuffer);if(R.__webglMultisampledFramebuffer)J.deleteFramebuffer(R.__webglMultisampledFramebuffer);if(R.__webglColorRenderbuffer){for(let R8=0;R8<R.__webglColorRenderbuffer.length;R8++)if(R.__webglColorRenderbuffer[R8])J.deleteRenderbuffer(R.__webglColorRenderbuffer[R8])}if(R.__webglDepthRenderbuffer)J.deleteRenderbuffer(R.__webglDepthRenderbuffer)}let z8=I.textures;for(let R8=0,I8=z8.length;R8<I8;R8++){let P8=Z.get(z8[R8]);if(P8.__webglTexture)J.deleteTexture(P8.__webglTexture),K.memory.textures--;Z.remove(z8[R8])}Z.remove(I)}let i=0;function X8(){i=0}function V8(){return i}function v8(I){i=I}function U8(){let I=i;if(I>=W.maxTextures)t8("WebGLTextures: Trying to use "+(I+1)+" texture units while this GPU supports only "+W.maxTextures);return i+=1,I}function M8(I){let R=[];return R.push(I.wrapS),R.push(I.wrapT),R.push(I.wrapR||0),R.push(I.magFilter),R.push(I.minFilter),R.push(I.anisotropy),R.push(I.internalFormat),R.push(I.format),R.push(I.type),R.push(I.generateMipmaps),R.push(I.mipmapsAutoUpdate),R.push(I.premultiplyAlpha),R.push(I.flipY),R.push(I.unpackAlignment),R.push(I.colorSpace),R.join()}function b8(I,R){let c=Z.get(I);if(I.isVideoTexture)f8(I);if(I.isRenderTargetTexture===!1&&I.isExternalTexture!==!0&&I.version>0&&c.__version!==I.version){let z8=I.image;if(z8===null)t8("WebGLRenderer: Texture marked for update but no image data found.");else if(z8.complete===!1)t8("WebGLRenderer: Texture marked for update but image is incomplete");else{o(c,I,R);return}}else if(I.isExternalTexture)c.__webglTexture=I.sourceTexture?I.sourceTexture:null;$.bindTexture(J.TEXTURE_2D,c.__webglTexture,J.TEXTURE0+R)}function n(I,R){let c=Z.get(I);if(I.isRenderTargetTexture===!1&&I.version>0&&c.__version!==I.version){o(c,I,R);return}else if(I.isExternalTexture)c.__webglTexture=I.sourceTexture?I.sourceTexture:null;$.bindTexture(J.TEXTURE_2D_ARRAY,c.__webglTexture,J.TEXTURE0+R)}function d(I,R){let c=Z.get(I);if(I.isRenderTargetTexture===!1&&I.version>0&&c.__version!==I.version){o(c,I,R);return}$.bindTexture(J.TEXTURE_3D,c.__webglTexture,J.TEXTURE0+R)}function P(I,R){let c=Z.get(I);if(I.version>0&&c.__version!==I.version){s(c,I,R);return}$.bindTexture(J.TEXTURE_CUBE_MAP,c.__webglTexture,J.TEXTURE0+R)}let C={[e0]:J.REPEAT,[j9]:J.CLAMP_TO_EDGE,[J5]:J.MIRRORED_REPEAT},g={[e6]:J.NEAREST,[I$]:J.NEAREST_MIPMAP_NEAREST,[Y0]:J.NEAREST_MIPMAP_LINEAR,[u6]:J.LINEAR,[Q5]:J.LINEAR_MIPMAP_NEAREST,[v7]:J.LINEAR_MIPMAP_LINEAR},K8={[y$]:J.NEVER,[EJ]:J.ALWAYS,[v$]:J.LESS,[GJ]:J.LEQUAL,[f$]:J.EQUAL,[NJ]:J.GEQUAL,[b$]:J.GREATER,[h$]:J.NOTEQUAL};function D8(I,R){if(R.type===I7&&Q.has("OES_texture_float_linear")===!1&&(R.magFilter===u6||R.magFilter===Q5||R.magFilter===Y0||R.magFilter===v7||R.minFilter===u6||R.minFilter===Q5||R.minFilter===Y0||R.minFilter===v7))t8("WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device.");if(J.texParameteri(I,J.TEXTURE_WRAP_S,C[R.wrapS]),J.texParameteri(I,J.TEXTURE_WRAP_T,C[R.wrapT]),I===J.TEXTURE_3D||I===J.TEXTURE_2D_ARRAY)J.texParameteri(I,J.TEXTURE_WRAP_R,C[R.wrapR]);if(J.texParameteri(I,J.TEXTURE_MAG_FILTER,g[R.magFilter]),J.texParameteri(I,J.TEXTURE_MIN_FILTER,g[R.minFilter]),R.compareFunction)J.texParameteri(I,J.TEXTURE_COMPARE_MODE,J.COMPARE_REF_TO_TEXTURE),J.texParameteri(I,J.TEXTURE_COMPARE_FUNC,K8[R.compareFunction]);if(Q.has("EXT_texture_filter_anisotropic")===!0){if(R.magFilter===e6)return;if(R.minFilter!==Y0&&R.minFilter!==v7)return;if(R.type===I7&&Q.has("OES_texture_float_linear")===!1)return;if(R.anisotropy>1||Z.get(R).__currentAnisotropy){let c=Q.get("EXT_texture_filter_anisotropic");J.texParameterf(I,c.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(R.anisotropy,W.getMaxAnisotropy())),Z.get(R).__currentAnisotropy=R.anisotropy}}}function A(I,R){let c=!1;if(I.__webglInit===void 0)I.__webglInit=!0,R.addEventListener("dispose",v),m(R);let z8=R.source,R8=F.get(z8);if(R8===void 0)R8={},F.set(z8,R8);let I8=M8(R);if(I8!==I.__cacheKey){if(R8[I8]===void 0)R8[I8]={texture:J.createTexture(),usedTimes:0},K.memory.textures++,c=!0;R8[I8].usedTimes++;let P8=R8[I.__cacheKey];if(P8!==void 0){if(R8[I.__cacheKey].usedTimes--,P8.usedTimes===0)S(R)}I.__cacheKey=I8,I.__webglTexture=R8[I8].texture}return c}function l(I,R,c){return Math.floor(Math.floor(I/c)/R)}function j(I,R,c,z8){let I8=I.updateRanges;if(I8.length===0)$.texSubImage2D(J.TEXTURE_2D,0,0,0,R.width,R.height,c,z8,R.data);else{I8.sort((b,F8)=>b.start-F8.start);let P8=0;for(let b=1;b<I8.length;b++){let F8=I8[P8],G8=I8[b],_8=F8.start+F8.count,C8=l(G8.start,R.width,4),y8=l(F8.start,R.width,4);if(G8.start<=_8+1&&C8===y8&&l(G8.start+G8.count-1,R.width,4)===C8)F8.count=Math.max(F8.count,G8.start+G8.count-F8.start);else++P8,I8[P8]=G8}I8.length=P8+1;let W8=$.getParameter(J.UNPACK_ROW_LENGTH),O8=$.getParameter(J.UNPACK_SKIP_PIXELS),w8=$.getParameter(J.UNPACK_SKIP_ROWS);$.pixelStorei(J.UNPACK_ROW_LENGTH,R.width);for(let b=0,F8=I8.length;b<F8;b++){let G8=I8[b],_8=Math.floor(G8.start/4),C8=Math.ceil(G8.count/4),y8=_8%R.width,o8=Math.floor(_8/R.width),s8=C8,x8=1;$.pixelStorei(J.UNPACK_SKIP_PIXELS,y8),$.pixelStorei(J.UNPACK_SKIP_ROWS,o8),$.texSubImage2D(J.TEXTURE_2D,0,y8,o8,s8,1,c,z8,R.data)}I.clearUpdateRanges(),$.pixelStorei(J.UNPACK_ROW_LENGTH,W8),$.pixelStorei(J.UNPACK_SKIP_PIXELS,O8),$.pixelStorei(J.UNPACK_SKIP_ROWS,w8)}}function o(I,R,c){let z8=J.TEXTURE_2D;if(R.isDataArrayTexture||R.isCompressedArrayTexture)z8=J.TEXTURE_2D_ARRAY;if(R.isData3DTexture)z8=J.TEXTURE_3D;let R8=A(I,R),I8=R.source;$.bindTexture(z8,I.__webglTexture,J.TEXTURE0+c);let P8=Z.get(I8);if(I8.version!==P8.__version||R8===!0){if($.activeTexture(J.TEXTURE0+c),(typeof ImageBitmap<"u"&&R.image instanceof ImageBitmap)===!1){let x8=K6.getPrimaries(K6.workingColorSpace),a8=R.colorSpace===e7?null:K6.getPrimaries(R.colorSpace),Q6=R.colorSpace===e7||x8===a8?J.NONE:J.BROWSER_DEFAULT_WEBGL;$.pixelStorei(J.UNPACK_FLIP_Y_WEBGL,R.flipY),$.pixelStorei(J.UNPACK_PREMULTIPLY_ALPHA_WEBGL,R.premultiplyAlpha),$.pixelStorei(J.UNPACK_COLORSPACE_CONVERSION_WEBGL,Q6)}$.pixelStorei(J.UNPACK_ALIGNMENT,R.unpackAlignment);let O8=_(R.image,!1,W.maxTextureSize);O8=j8(R,O8);let w8=q.convert(R.format,R.colorSpace),b=q.convert(R.type),F8=y(R.internalFormat,w8,b,R.normalized,R.colorSpace,R.isVideoTexture);D8(z8,R);let G8,_8=R.mipmaps,C8=R.isVideoTexture!==!0,y8=P8.__version===void 0||R8===!0,o8=I8.dataReady,s8=z(R,O8);if(R.isDepthTexture){if(F8=D(R.format===b7,R.type),y8)if(C8)$.texStorage2D(J.TEXTURE_2D,1,F8,O8.width,O8.height);else $.texImage2D(J.TEXTURE_2D,0,F8,O8.width,O8.height,0,w8,b,null)}else if(R.isDataTexture)if(_8.length>0){if(C8&&y8)$.texStorage2D(J.TEXTURE_2D,s8,F8,_8[0].width,_8[0].height);for(let x8=0,a8=_8.length;x8<a8;x8++)if(G8=_8[x8],C8){if(o8)$.texSubImage2D(J.TEXTURE_2D,x8,0,0,G8.width,G8.height,w8,b,G8.data)}else $.texImage2D(J.TEXTURE_2D,x8,F8,G8.width,G8.height,0,w8,b,G8.data);R.generateMipmaps=!1}else if(C8){if(y8)$.texStorage2D(J.TEXTURE_2D,s8,F8,O8.width,O8.height);if(o8)j(R,O8,w8,b)}else $.texImage2D(J.TEXTURE_2D,0,F8,O8.width,O8.height,0,w8,b,O8.data);else if(R.isCompressedTexture)if(R.isCompressedArrayTexture){if(C8&&y8)$.texStorage3D(J.TEXTURE_2D_ARRAY,s8,F8,_8[0].width,_8[0].height,O8.depth);for(let x8=0,a8=_8.length;x8<a8;x8++)if(G8=_8[x8],R.format!==Q7)if(w8!==null)if(C8){if(o8)if(R.layerUpdates.size>0){let Q6=sJ(G8.width,G8.height,R.format,R.type);for(let g8 of R.layerUpdates){let X6=G8.data.subarray(g8*Q6/G8.data.BYTES_PER_ELEMENT,(g8+1)*Q6/G8.data.BYTES_PER_ELEMENT);$.compressedTexSubImage3D(J.TEXTURE_2D_ARRAY,x8,0,0,g8,G8.width,G8.height,1,w8,X6)}}else $.compressedTexSubImage3D(J.TEXTURE_2D_ARRAY,x8,0,0,0,G8.width,G8.height,O8.depth,w8,G8.data)}else $.compressedTexImage3D(J.TEXTURE_2D_ARRAY,x8,F8,G8.width,G8.height,O8.depth,0,G8.data,0,0);else t8("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else if(C8){if(o8)$.texSubImage3D(J.TEXTURE_2D_ARRAY,x8,0,0,0,G8.width,G8.height,O8.depth,w8,b,G8.data)}else $.texImage3D(J.TEXTURE_2D_ARRAY,x8,F8,G8.width,G8.height,O8.depth,0,w8,b,G8.data);if(R.layerUpdates.size>0)R.clearLayerUpdates()}else{if(C8&&y8)$.texStorage2D(J.TEXTURE_2D,s8,F8,_8[0].width,_8[0].height);for(let x8=0,a8=_8.length;x8<a8;x8++)if(G8=_8[x8],R.format!==Q7)if(w8!==null)if(C8){if(o8)$.compressedTexSubImage2D(J.TEXTURE_2D,x8,0,0,G8.width,G8.height,w8,G8.data)}else $.compressedTexImage2D(J.TEXTURE_2D,x8,F8,G8.width,G8.height,0,G8.data);else t8("WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else if(C8){if(o8)$.texSubImage2D(J.TEXTURE_2D,x8,0,0,G8.width,G8.height,w8,b,G8.data)}else $.texImage2D(J.TEXTURE_2D,x8,F8,G8.width,G8.height,0,w8,b,G8.data)}else if(R.isDataArrayTexture)if(C8){if(y8)$.texStorage3D(J.TEXTURE_2D_ARRAY,s8,F8,O8.width,O8.height,O8.depth);if(o8)if(R.layerUpdates.size>0){let x8=sJ(O8.width,O8.height,R.format,R.type);for(let a8 of R.layerUpdates){let Q6=O8.data.subarray(a8*x8/O8.data.BYTES_PER_ELEMENT,(a8+1)*x8/O8.data.BYTES_PER_ELEMENT);$.texSubImage3D(J.TEXTURE_2D_ARRAY,0,0,0,a8,O8.width,O8.height,1,w8,b,Q6)}R.clearLayerUpdates()}else $.texSubImage3D(J.TEXTURE_2D_ARRAY,0,0,0,0,O8.width,O8.height,O8.depth,w8,b,O8.data)}else $.texImage3D(J.TEXTURE_2D_ARRAY,0,F8,O8.width,O8.height,O8.depth,0,w8,b,O8.data);else if(R.isData3DTexture)if(C8){if(y8)$.texStorage3D(J.TEXTURE_3D,s8,F8,O8.width,O8.height,O8.depth);if(o8)$.texSubImage3D(J.TEXTURE_3D,0,0,0,0,O8.width,O8.height,O8.depth,w8,b,O8.data)}else $.texImage3D(J.TEXTURE_3D,0,F8,O8.width,O8.height,O8.depth,0,w8,b,O8.data);else if(R.isFramebufferTexture){if(y8)if(C8)$.texStorage2D(J.TEXTURE_2D,s8,F8,O8.width,O8.height);else{let{width:x8,height:a8}=O8;for(let Q6=0;Q6<s8;Q6++)$.texImage2D(J.TEXTURE_2D,Q6,F8,x8,a8,0,w8,b,null),x8>>=1,a8>>=1}}else if(R.isHTMLTexture){if("texElementImage2D"in J){let x8=J.canvas;if(!x8.hasAttribute("layoutsubtree"))x8.setAttribute("layoutsubtree","true");if(O8.parentNode!==x8){x8.appendChild(O8),G.add(R),x8.onpaint=(a8)=>{let Q6=a8.changedElements;for(let g8 of G)if(Q6.includes(g8.image))g8.needsUpdate=!0},x8.requestPaint();return}if(J.texElementImage2D.length===3)J.texElementImage2D(J.TEXTURE_2D,J.RGBA8,O8);else{let{RGBA:Q6,RGBA:g8,UNSIGNED_BYTE:X6}=J;J.texElementImage2D(J.TEXTURE_2D,0,Q6,g8,X6,O8)}J.texParameteri(J.TEXTURE_2D,J.TEXTURE_MIN_FILTER,J.LINEAR),J.texParameteri(J.TEXTURE_2D,J.TEXTURE_WRAP_S,J.CLAMP_TO_EDGE),J.texParameteri(J.TEXTURE_2D,J.TEXTURE_WRAP_T,J.CLAMP_TO_EDGE)}}else if(_8.length>0){if(C8&&y8){let x8=l8(_8[0]);$.texStorage2D(J.TEXTURE_2D,s8,F8,x8.width,x8.height)}for(let x8=0,a8=_8.length;x8<a8;x8++)if(G8=_8[x8],C8){if(o8)$.texSubImage2D(J.TEXTURE_2D,x8,0,0,w8,b,G8)}else $.texImage2D(J.TEXTURE_2D,x8,F8,w8,b,G8);R.generateMipmaps=!1}else if(C8){if(y8){let x8=l8(O8);$.texStorage2D(J.TEXTURE_2D,s8,F8,x8.width,x8.height)}if(o8)$.texSubImage2D(J.TEXTURE_2D,0,0,0,w8,b,O8)}else $.texImage2D(J.TEXTURE_2D,0,F8,w8,b,O8);if(V(R)&&R.mipmapsAutoUpdate===!0)B(z8);if(P8.__version=I8.version,R.onUpdate)R.onUpdate(R)}I.__version=R.version}function s(I,R,c){if(R.image.length!==6)return;let z8=A(I,R),R8=R.source;$.bindTexture(J.TEXTURE_CUBE_MAP,I.__webglTexture,J.TEXTURE0+c);let I8=Z.get(R8);if(R8.version!==I8.__version||z8===!0){$.activeTexture(J.TEXTURE0+c);let P8=K6.getPrimaries(K6.workingColorSpace),W8=R.colorSpace===e7?null:K6.getPrimaries(R.colorSpace),O8=R.colorSpace===e7||P8===W8?J.NONE:J.BROWSER_DEFAULT_WEBGL;$.pixelStorei(J.UNPACK_FLIP_Y_WEBGL,R.flipY),$.pixelStorei(J.UNPACK_PREMULTIPLY_ALPHA_WEBGL,R.premultiplyAlpha),$.pixelStorei(J.UNPACK_ALIGNMENT,R.unpackAlignment),$.pixelStorei(J.UNPACK_COLORSPACE_CONVERSION_WEBGL,O8);let w8=R.isCompressedTexture||R.image[0].isCompressedTexture,b=R.image[0]&&R.image[0].isDataTexture,F8=[];for(let g8=0;g8<6;g8++){if(!w8&&!b)F8[g8]=_(R.image[g8],!0,W.maxCubemapSize);else F8[g8]=b?R.image[g8].image:R.image[g8];F8[g8]=j8(R,F8[g8])}let G8=F8[0],_8=q.convert(R.format,R.colorSpace),C8=q.convert(R.type),y8=y(R.internalFormat,_8,C8,R.normalized,R.colorSpace),o8=R.isVideoTexture!==!0,s8=I8.__version===void 0||z8===!0,x8=R8.dataReady,a8=z(R,G8);D8(J.TEXTURE_CUBE_MAP,R);let Q6;if(R.isDepthTexture){if(y8=D(R.format===b7,R.type),s8)if(o8)$.texStorage2D(J.TEXTURE_CUBE_MAP,1,y8,G8.width,G8.height);else for(let g8=0;g8<6;g8++)$.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,0,y8,G8.width,G8.height,0,_8,C8,null)}else if(w8){if(o8&&s8)$.texStorage2D(J.TEXTURE_CUBE_MAP,a8,y8,G8.width,G8.height);for(let g8=0;g8<6;g8++){Q6=F8[g8].mipmaps;for(let X6=0;X6<Q6.length;X6++){let A6=Q6[X6];if(R.format!==Q7)if(_8!==null)if(o8){if(x8)$.compressedTexSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,X6,0,0,A6.width,A6.height,_8,A6.data)}else $.compressedTexImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,X6,y8,A6.width,A6.height,0,A6.data);else t8("WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()");else if(o8){if(x8)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,X6,0,0,A6.width,A6.height,_8,C8,A6.data)}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,X6,y8,A6.width,A6.height,0,_8,C8,A6.data)}}}else{if(Q6=R.mipmaps,o8&&s8){if(Q6.length>0)a8++;let g8=l8(F8[0]);$.texStorage2D(J.TEXTURE_CUBE_MAP,a8,y8,g8.width,g8.height)}for(let g8=0;g8<6;g8++)if(b){if(o8){if(x8)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,0,0,0,F8[g8].width,F8[g8].height,_8,C8,F8[g8].data)}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,0,y8,F8[g8].width,F8[g8].height,0,_8,C8,F8[g8].data);for(let X6=0;X6<Q6.length;X6++){let F7=Q6[X6].image[g8].image;if(o8){if(x8)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,X6+1,0,0,F7.width,F7.height,_8,C8,F7.data)}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,X6+1,y8,F7.width,F7.height,0,_8,C8,F7.data)}}else{if(o8){if(x8)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,0,0,0,_8,C8,F8[g8])}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,0,y8,_8,C8,F8[g8]);for(let X6=0;X6<Q6.length;X6++){let A6=Q6[X6];if(o8){if(x8)$.texSubImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,X6+1,0,0,_8,C8,A6.image[g8])}else $.texImage2D(J.TEXTURE_CUBE_MAP_POSITIVE_X+g8,X6+1,y8,_8,C8,A6.image[g8])}}}if(V(R)&&R.mipmapsAutoUpdate===!0)B(J.TEXTURE_CUBE_MAP);if(I8.__version=R8.version,R.onUpdate)R.onUpdate(R)}I.__version=R.version}function q8(I,R,c,z8,R8,I8){let P8=q.convert(c.format,c.colorSpace),W8=q.convert(c.type),O8=y(c.internalFormat,P8,W8,c.normalized,c.colorSpace),w8=Z.get(R),b=Z.get(c);if(b.__renderTarget=R,!w8.__hasExternalTextures){let F8=Math.max(1,R.width>>I8),G8=Math.max(1,R.height>>I8);if(R8===J.TEXTURE_3D||R8===J.TEXTURE_2D_ARRAY)$.texImage3D(R8,I8,O8,F8,G8,R.depth,0,P8,W8,null);else $.texImage2D(R8,I8,O8,F8,G8,0,P8,W8,null)}if($.bindFramebuffer(J.FRAMEBUFFER,I),m8(R))H.framebufferTexture2DMultisampleEXT(J.FRAMEBUFFER,z8,R8,b.__webglTexture,0,Q8(R));else if(R8===J.TEXTURE_2D||R8>=J.TEXTURE_CUBE_MAP_POSITIVE_X&&R8<=J.TEXTURE_CUBE_MAP_NEGATIVE_Z)J.framebufferTexture2D(J.FRAMEBUFFER,z8,R8,b.__webglTexture,I8);$.bindFramebuffer(J.FRAMEBUFFER,null)}function N8(I,R,c){if(J.bindRenderbuffer(J.RENDERBUFFER,I),R.depthBuffer){let z8=R.depthTexture,R8=z8&&z8.isDepthTexture?z8.type:null,I8=D(R.stencilBuffer,R8),P8=R.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT;if(m8(R))H.renderbufferStorageMultisampleEXT(J.RENDERBUFFER,Q8(R),I8,R.width,R.height);else if(c)J.renderbufferStorageMultisample(J.RENDERBUFFER,Q8(R),I8,R.width,R.height);else J.renderbufferStorage(J.RENDERBUFFER,I8,R.width,R.height);J.framebufferRenderbuffer(J.FRAMEBUFFER,P8,J.RENDERBUFFER,I)}else{let z8=R.textures;for(let R8=0;R8<z8.length;R8++){let I8=z8[R8],P8=q.convert(I8.format,I8.colorSpace),W8=q.convert(I8.type),O8=y(I8.internalFormat,P8,W8,I8.normalized,I8.colorSpace);if(m8(R))H.renderbufferStorageMultisampleEXT(J.RENDERBUFFER,Q8(R),O8,R.width,R.height);else if(c)J.renderbufferStorageMultisample(J.RENDERBUFFER,Q8(R),O8,R.width,R.height);else J.renderbufferStorage(J.RENDERBUFFER,O8,R.width,R.height)}}J.bindRenderbuffer(J.RENDERBUFFER,null)}function h(I,R,c){let z8=R.isWebGLCubeRenderTarget===!0;if($.bindFramebuffer(J.FRAMEBUFFER,I),!(R.depthTexture&&R.depthTexture.isDepthTexture))throw Error("THREE.WebGLTextures: renderTarget.depthTexture must be an instance of THREE.DepthTexture.");let R8=Z.get(R.depthTexture);R8.__renderTarget=R;let I8=z8?R.depthTexture.image[0]:R.depthTexture.image;if(!R8.__webglTexture||I8.width!==R.width||I8.height!==R.height)I8.width=R.width,I8.height=R.height,R.depthTexture.needsUpdate=!0;if(z8)P(R.depthTexture,0);else b8(R.depthTexture,0);let P8=R8.__webglTexture,W8=Q8(R),O8=z8?J.TEXTURE_CUBE_MAP_POSITIVE_X+c:J.TEXTURE_2D,w8=R.depthTexture.format===b7?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT;if(R.depthTexture.format===y9)if(m8(R))H.framebufferTexture2DMultisampleEXT(J.FRAMEBUFFER,w8,O8,P8,0,W8);else J.framebufferTexture2D(J.FRAMEBUFFER,w8,O8,P8,0);else if(R.depthTexture.format===b7)if(m8(R))H.framebufferTexture2DMultisampleEXT(J.FRAMEBUFFER,w8,O8,P8,0,W8);else J.framebufferTexture2D(J.FRAMEBUFFER,w8,O8,P8,0);else throw Error("THREE.WebGLTextures: Unknown depthTexture format.")}function x(I){let R=Z.get(I),c=I.isWebGLCubeRenderTarget===!0;if(R.__boundDepthTexture!==I.depthTexture){let z8=I.depthTexture;if(R.__depthDisposeCallback)R.__depthDisposeCallback();if(z8){let R8=()=>{delete R.__boundDepthTexture,delete R.__depthDisposeCallback,z8.removeEventListener("dispose",R8)};z8.addEventListener("dispose",R8),R.__depthDisposeCallback=R8}R.__boundDepthTexture=z8}if(I.depthTexture&&!R.__autoAllocateDepthBuffer)if(c)for(let z8=0;z8<6;z8++)h(R.__webglFramebuffer[z8],I,z8);else if(I.texture.mipmaps.length>0)h(R.__webglFramebuffer[0],I,0);else h(R.__webglFramebuffer,I,0);else if(c){R.__webglDepthbuffer=[];for(let z8=0;z8<6;z8++)if($.bindFramebuffer(J.FRAMEBUFFER,R.__webglFramebuffer[z8]),R.__webglDepthbuffer[z8]===void 0)R.__webglDepthbuffer[z8]=J.createRenderbuffer(),N8(R.__webglDepthbuffer[z8],I,!1);else{let R8=I.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT,I8=R.__webglDepthbuffer[z8];J.bindRenderbuffer(J.RENDERBUFFER,I8),J.framebufferRenderbuffer(J.FRAMEBUFFER,R8,J.RENDERBUFFER,I8)}}else{if(I.texture.mipmaps.length>0)$.bindFramebuffer(J.FRAMEBUFFER,R.__webglFramebuffer[0]);else $.bindFramebuffer(J.FRAMEBUFFER,R.__webglFramebuffer);if(R.__webglDepthbuffer===void 0)R.__webglDepthbuffer=J.createRenderbuffer(),N8(R.__webglDepthbuffer,I,!1);else{let R8=I.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT,I8=R.__webglDepthbuffer;J.bindRenderbuffer(J.RENDERBUFFER,I8),J.framebufferRenderbuffer(J.FRAMEBUFFER,R8,J.RENDERBUFFER,I8)}}$.bindFramebuffer(J.FRAMEBUFFER,null)}function k8(I,R,c){let z8=Z.get(I);if(R!==void 0)q8(z8.__webglFramebuffer,I,I.texture,J.COLOR_ATTACHMENT0,J.TEXTURE_2D,0);if(c!==void 0)x(I)}function f(I){let R=I.texture,c=Z.get(I),z8=Z.get(R);I.addEventListener("dispose",J8),m(I);let R8=I.textures,I8=I.isWebGLCubeRenderTarget===!0,P8=R8.length>1;if(!P8){if(z8.__webglTexture===void 0)z8.__webglTexture=J.createTexture();z8.__version=R.version,K.memory.textures++}if(I8){c.__webglFramebuffer=[];for(let W8=0;W8<6;W8++)if(R.mipmaps.length>0){c.__webglFramebuffer[W8]=[];for(let O8=0;O8<R.mipmaps.length;O8++)c.__webglFramebuffer[W8][O8]=J.createFramebuffer()}else c.__webglFramebuffer[W8]=J.createFramebuffer()}else{if(R.mipmaps.length>0){c.__webglFramebuffer=[];for(let W8=0;W8<R.mipmaps.length;W8++)c.__webglFramebuffer[W8]=J.createFramebuffer()}else c.__webglFramebuffer=J.createFramebuffer();if(P8)for(let W8=0,O8=R8.length;W8<O8;W8++){let w8=Z.get(R8[W8]);if(w8.__webglTexture===void 0)w8.__webglTexture=J.createTexture(),K.memory.textures++}if(I.samples>0&&m8(I)===!1){c.__webglMultisampledFramebuffer=J.createFramebuffer(),c.__webglColorRenderbuffer=[],$.bindFramebuffer(J.FRAMEBUFFER,c.__webglMultisampledFramebuffer);for(let W8=0;W8<R8.length;W8++){let O8=R8[W8];c.__webglColorRenderbuffer[W8]=J.createRenderbuffer(),J.bindRenderbuffer(J.RENDERBUFFER,c.__webglColorRenderbuffer[W8]);let w8=q.convert(O8.format,O8.colorSpace),b=q.convert(O8.type),F8=y(O8.internalFormat,w8,b,O8.normalized,O8.colorSpace,I.isXRRenderTarget===!0),G8=Q8(I);J.renderbufferStorageMultisample(J.RENDERBUFFER,G8,F8,I.width,I.height),J.framebufferRenderbuffer(J.FRAMEBUFFER,J.COLOR_ATTACHMENT0+W8,J.RENDERBUFFER,c.__webglColorRenderbuffer[W8])}if(J.bindRenderbuffer(J.RENDERBUFFER,null),I.depthBuffer)c.__webglDepthRenderbuffer=J.createRenderbuffer(),N8(c.__webglDepthRenderbuffer,I,!0);$.bindFramebuffer(J.FRAMEBUFFER,null)}}if(I8){$.bindTexture(J.TEXTURE_CUBE_MAP,z8.__webglTexture),D8(J.TEXTURE_CUBE_MAP,R);for(let W8=0;W8<6;W8++)if(R.mipmaps.length>0)for(let O8=0;O8<R.mipmaps.length;O8++)q8(c.__webglFramebuffer[W8][O8],I,R,J.COLOR_ATTACHMENT0,J.TEXTURE_CUBE_MAP_POSITIVE_X+W8,O8);else q8(c.__webglFramebuffer[W8],I,R,J.COLOR_ATTACHMENT0,J.TEXTURE_CUBE_MAP_POSITIVE_X+W8,0);if(V(R))B(J.TEXTURE_CUBE_MAP);else if(R.mipmaps.length>0)J.texParameteri(J.TEXTURE_CUBE_MAP,J.TEXTURE_MAX_LEVEL,R.mipmaps.length-1);$.unbindTexture()}else if(P8){for(let W8=0,O8=R8.length;W8<O8;W8++){let w8=R8[W8],b=Z.get(w8),F8=J.TEXTURE_2D;if(I.isWebGL3DRenderTarget||I.isWebGLArrayRenderTarget)F8=I.isWebGL3DRenderTarget?J.TEXTURE_3D:J.TEXTURE_2D_ARRAY;if($.bindTexture(F8,b.__webglTexture),D8(F8,w8),q8(c.__webglFramebuffer,I,w8,J.COLOR_ATTACHMENT0+W8,F8,0),V(w8))B(F8)}$.unbindTexture()}else{let W8=J.TEXTURE_2D;if(I.isWebGL3DRenderTarget||I.isWebGLArrayRenderTarget)W8=I.isWebGL3DRenderTarget?J.TEXTURE_3D:J.TEXTURE_2D_ARRAY;if($.bindTexture(W8,z8.__webglTexture),D8(W8,R),R.mipmaps.length>0)for(let O8=0;O8<R.mipmaps.length;O8++)q8(c.__webglFramebuffer[O8],I,R,J.COLOR_ATTACHMENT0,W8,O8);else q8(c.__webglFramebuffer,I,R,J.COLOR_ATTACHMENT0,W8,0);if(V(R))B(W8);else if(R.mipmaps.length>0)J.texParameteri(W8,J.TEXTURE_MAX_LEVEL,R.mipmaps.length-1);$.unbindTexture()}if(I.depthBuffer)x(I)}function Y8(I){let R=I.textures;for(let c=0,z8=R.length;c<z8;c++){let R8=R[c];if(V(R8)&&R8.mipmapsAutoUpdate===!0){let I8=w(I),P8=Z.get(R8).__webglTexture;$.bindTexture(I8,P8),B(I8),$.unbindTexture()}}}let Z8=[];function A8(I){if(I.samples>0){if(m8(I)===!1){let{textures:R,width:c,height:z8}=I,R8=J.COLOR_BUFFER_BIT,I8=I.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT,P8=Z.get(I),W8=R.length>1;if(W8)for(let w8=0;w8<R.length;w8++)$.bindFramebuffer(J.FRAMEBUFFER,P8.__webglMultisampledFramebuffer),J.framebufferRenderbuffer(J.FRAMEBUFFER,J.COLOR_ATTACHMENT0+w8,J.RENDERBUFFER,null),$.bindFramebuffer(J.FRAMEBUFFER,P8.__webglFramebuffer),J.framebufferTexture2D(J.DRAW_FRAMEBUFFER,J.COLOR_ATTACHMENT0+w8,J.TEXTURE_2D,null,0);if($.bindFramebuffer(J.READ_FRAMEBUFFER,P8.__webglMultisampledFramebuffer),I.texture.mipmaps.length>0)$.bindFramebuffer(J.DRAW_FRAMEBUFFER,P8.__webglFramebuffer[0]);else $.bindFramebuffer(J.DRAW_FRAMEBUFFER,P8.__webglFramebuffer);for(let w8=0;w8<R.length;w8++){if(I.resolveDepthBuffer){if(I.depthBuffer)R8|=J.DEPTH_BUFFER_BIT;if(I.stencilBuffer&&I.resolveStencilBuffer)R8|=J.STENCIL_BUFFER_BIT}if(W8){J.framebufferRenderbuffer(J.READ_FRAMEBUFFER,J.COLOR_ATTACHMENT0,J.RENDERBUFFER,P8.__webglColorRenderbuffer[w8]);let b=Z.get(R[w8]).__webglTexture;J.framebufferTexture2D(J.DRAW_FRAMEBUFFER,J.COLOR_ATTACHMENT0,J.TEXTURE_2D,b,0)}if(J.blitFramebuffer(0,0,c,z8,0,0,c,z8,R8,J.NEAREST),U===!0){if(Z8.length=0,Z8.push(J.COLOR_ATTACHMENT0+w8),I.depthBuffer&&I.storeMultisampledDepthBuffer===!1)Z8.push(I8);J.invalidateFramebuffer(J.READ_FRAMEBUFFER,Z8)}}if($.bindFramebuffer(J.READ_FRAMEBUFFER,null),$.bindFramebuffer(J.DRAW_FRAMEBUFFER,null),W8)for(let w8=0;w8<R.length;w8++){$.bindFramebuffer(J.FRAMEBUFFER,P8.__webglMultisampledFramebuffer),J.framebufferRenderbuffer(J.FRAMEBUFFER,J.COLOR_ATTACHMENT0+w8,J.RENDERBUFFER,P8.__webglColorRenderbuffer[w8]);let b=Z.get(R[w8]).__webglTexture;$.bindFramebuffer(J.FRAMEBUFFER,P8.__webglFramebuffer),J.framebufferTexture2D(J.DRAW_FRAMEBUFFER,J.COLOR_ATTACHMENT0+w8,J.TEXTURE_2D,b,0)}$.bindFramebuffer(J.DRAW_FRAMEBUFFER,P8.__webglMultisampledFramebuffer)}else if(I.depthBuffer&&I.storeMultisampledDepthBuffer===!1&&U){let R=I.stencilBuffer?J.DEPTH_STENCIL_ATTACHMENT:J.DEPTH_ATTACHMENT;J.invalidateFramebuffer(J.DRAW_FRAMEBUFFER,[R])}}}function Q8(I){return Math.min(W.maxSamples,I.samples)}function m8(I){let R=Z.get(I);return I.samples>0&&Q.has("WEBGL_multisampled_render_to_texture")===!0&&R.__useRenderToTexture!==!1}function f8(I){let R=K.render.frame;if(X.get(I)!==R)X.set(I,R),I.update()}function j8(I,R){let{colorSpace:c,format:z8,type:R8}=I;if(I.isCompressedTexture===!0||I.isVideoTexture===!0)return R;if(c!==YJ&&c!==e7)if(K6.getTransfer(c)===E6){if(z8!==Q7||R8!==J7)t8("WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType.")}else e8("WebGLTextures: Unsupported texture color space:",c);return R}function l8(I){if(typeof HTMLImageElement<"u"&&I instanceof HTMLImageElement)Y.width=I.naturalWidth||I.width,Y.height=I.naturalHeight||I.height;else if(typeof VideoFrame<"u"&&I instanceof VideoFrame)Y.width=I.displayWidth,Y.height=I.displayHeight;else Y.width=I.width,Y.height=I.height;return Y}this.allocateTextureUnit=U8,this.resetTextureUnits=X8,this.getTextureUnits=V8,this.setTextureUnits=v8,this.setTexture2D=b8,this.setTexture2DArray=n,this.setTexture3D=d,this.setTextureCube=P,this.rebindTextures=k8,this.setupRenderTarget=f,this.updateRenderTargetMipmap=Y8,this.updateMultisampleRenderTarget=A8,this.setupDepthRenderbuffer=x,this.setupFrameBufferTexture=q8,this.useMultisampledRTT=m8,this.dispose=H8}function JX(J,Q){function $(Z,W=e7){let q,K=K6.getTransfer(W);if(Z===J7)return J.UNSIGNED_BYTE;if(Z===C1)return J.UNSIGNED_SHORT_4_4_4_4;if(Z===P1)return J.UNSIGNED_SHORT_5_5_5_1;if(Z===C$)return J.UNSIGNED_INT_5_9_9_9_REV;if(Z===P$)return J.UNSIGNED_INT_10F_11F_11F_REV;if(Z===A$)return J.BYTE;if(Z===_$)return J.SHORT;if(Z===X0)return J.UNSIGNED_SHORT;if(Z===_1)return J.INT;if(Z===f7)return J.UNSIGNED_INT;if(Z===I7)return J.FLOAT;if(Z===G7)return J.HALF_FLOAT;if(Z===w$)return J.ALPHA;if(Z===T$)return J.RGB;if(Z===Q7)return J.RGBA;if(Z===y9)return J.DEPTH_COMPONENT;if(Z===b7)return J.DEPTH_STENCIL;if(Z===S$)return J.RED;if(Z===w1)return J.RED_INTEGER;if(Z===t7)return J.RG;if(Z===T1)return J.RG_INTEGER;if(Z===S1)return J.RGBA_INTEGER;if(Z===$5||Z===Z5||Z===W5||Z===q5)if(K===E6)if(q=Q.get("WEBGL_compressed_texture_s3tc_srgb"),q!==null){if(Z===$5)return q.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(Z===Z5)return q.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(Z===W5)return q.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(Z===q5)return q.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(q=Q.get("WEBGL_compressed_texture_s3tc"),q!==null){if(Z===$5)return q.COMPRESSED_RGB_S3TC_DXT1_EXT;if(Z===Z5)return q.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(Z===W5)return q.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(Z===q5)return q.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(Z===j1||Z===y1||Z===v1||Z===f1)if(q=Q.get("WEBGL_compressed_texture_pvrtc"),q!==null){if(Z===j1)return q.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(Z===y1)return q.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(Z===v1)return q.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(Z===f1)return q.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(Z===b1||Z===h1||Z===x1||Z===g1||Z===p1||Z===K5||Z===m1)if(q=Q.get("WEBGL_compressed_texture_etc"),q!==null){if(Z===b1||Z===h1)return K===E6?q.COMPRESSED_SRGB8_ETC2:q.COMPRESSED_RGB8_ETC2;if(Z===x1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:q.COMPRESSED_RGBA8_ETC2_EAC;if(Z===g1)return q.COMPRESSED_R11_EAC;if(Z===p1)return q.COMPRESSED_SIGNED_R11_EAC;if(Z===K5)return q.COMPRESSED_RG11_EAC;if(Z===m1)return q.COMPRESSED_SIGNED_RG11_EAC}else return null;if(Z===l1||Z===d1||Z===u1||Z===c1||Z===n1||Z===s1||Z===i1||Z===o1||Z===a1||Z===r1||Z===t1||Z===e1||Z===JJ||Z===QJ)if(q=Q.get("WEBGL_compressed_texture_astc"),q!==null){if(Z===l1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:q.COMPRESSED_RGBA_ASTC_4x4_KHR;if(Z===d1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:q.COMPRESSED_RGBA_ASTC_5x4_KHR;if(Z===u1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:q.COMPRESSED_RGBA_ASTC_5x5_KHR;if(Z===c1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:q.COMPRESSED_RGBA_ASTC_6x5_KHR;if(Z===n1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:q.COMPRESSED_RGBA_ASTC_6x6_KHR;if(Z===s1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:q.COMPRESSED_RGBA_ASTC_8x5_KHR;if(Z===i1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:q.COMPRESSED_RGBA_ASTC_8x6_KHR;if(Z===o1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:q.COMPRESSED_RGBA_ASTC_8x8_KHR;if(Z===a1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:q.COMPRESSED_RGBA_ASTC_10x5_KHR;if(Z===r1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:q.COMPRESSED_RGBA_ASTC_10x6_KHR;if(Z===t1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:q.COMPRESSED_RGBA_ASTC_10x8_KHR;if(Z===e1)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:q.COMPRESSED_RGBA_ASTC_10x10_KHR;if(Z===JJ)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:q.COMPRESSED_RGBA_ASTC_12x10_KHR;if(Z===QJ)return K===E6?q.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:q.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(Z===$J||Z===ZJ||Z===WJ)if(q=Q.get("EXT_texture_compression_bptc"),q!==null){if(Z===$J)return K===E6?q.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:q.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(Z===ZJ)return q.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(Z===WJ)return q.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(Z===qJ||Z===KJ||Z===H5||Z===HJ)if(q=Q.get("EXT_texture_compression_rgtc"),q!==null){if(Z===qJ)return q.COMPRESSED_RED_RGTC1_EXT;if(Z===KJ)return q.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(Z===H5)return q.COMPRESSED_RED_GREEN_RGTC2_EXT;if(Z===HJ)return q.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;if(Z===r7)return J.UNSIGNED_INT_24_8;return J[Z]!==void 0?J[Z]:null}return{convert:$}}var QX=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,$X=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class pZ{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(J,Q){if(this.texture===null){let $=new M5(J.texture);if(J.depthNear!==Q.depthNear||J.depthFar!==Q.depthFar)this.depthNear=J.depthNear,this.depthFar=J.depthFar;this.texture=$}}getMesh(J){if(this.texture!==null){if(this.mesh===null){let Q=J.cameras[0].viewport,$=new Z7({vertexShader:QX,fragmentShader:$X,uniforms:{depthColor:{value:this.texture},depthWidth:{value:Q.z},depthHeight:{value:Q.w}}});this.mesh=new M6(new Z9(20,20),$)}}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class mZ extends A7{constructor(J,Q){super();let $=this,Z=null,W=1,q=null,K="local-floor",H=1,U=null,Y=null,X=null,G=null,N=null,F=null,M=typeof XRWebGLBinding<"u",L=new pZ,E={},O=Q.getContextAttributes(),_=null,V=null,B=[],w=[],y=new L8,D=null,z=null,m=new x6;m.viewport=new R6;let t=new x6;t.viewport=new R6;let v=[m,t],J8=new uJ,E8=null,T=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(U8){let M8=B[U8];if(M8===void 0)M8=new N0,B[U8]=M8;return M8.getTargetRaySpace()},this.getControllerGrip=function(U8){let M8=B[U8];if(M8===void 0)M8=new N0,B[U8]=M8;return M8.getGripSpace()},this.getHand=function(U8){let M8=B[U8];if(M8===void 0)M8=new N0,B[U8]=M8;return M8.getHandSpace()};function H8(U8){let M8=w.indexOf(U8.inputSource);if(M8===-1)return;let b8=B[M8];if(b8!==void 0)b8.update(U8.inputSource,U8.frame,U||q),b8.dispatchEvent({type:U8.type,data:U8.inputSource})}function e(){Z.removeEventListener("select",H8),Z.removeEventListener("selectstart",H8),Z.removeEventListener("selectend",H8),Z.removeEventListener("squeeze",H8),Z.removeEventListener("squeezestart",H8),Z.removeEventListener("squeezeend",H8),Z.removeEventListener("end",e),Z.removeEventListener("inputsourceschange",S);for(let U8=0;U8<B.length;U8++){let M8=w[U8];if(M8===null)continue;w[U8]=null,B[U8].disconnect(M8)}E8=null,T=null,L.reset();for(let U8 in E)delete E[U8];if(J.setRenderTarget(_),N=null,G=null,X=null,Z=null,V=null,v8.stop(),$.isPresenting=!1,J.setPixelRatio(D),J.setSize(y.width,y.height,!1),z!==null){let U8=z.camera;U8.fov=z.fov,U8.zoom=z.zoom,U8.updateProjectionMatrix(),z=null}$.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(U8){if(W=U8,$.isPresenting===!0)t8("WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(U8){if(K=U8,$.isPresenting===!0)t8("WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return U||q},this.setReferenceSpace=function(U8){U=U8},this.getBaseLayer=function(){return G!==null?G:N},this.getBinding=function(){if(X===null&&M)X=new XRWebGLBinding(Z,Q);return X},this.getFrame=function(){return F},this.getSession=function(){return Z},this.setSession=async function(U8){if(Z=U8,Z!==null){if(_=J.getRenderTarget(),Z.addEventListener("select",H8),Z.addEventListener("selectstart",H8),Z.addEventListener("selectend",H8),Z.addEventListener("squeeze",H8),Z.addEventListener("squeezestart",H8),Z.addEventListener("squeezeend",H8),Z.addEventListener("end",e),Z.addEventListener("inputsourceschange",S),O.xrCompatible!==!0)await Q.makeXRCompatible();if(D=J.getPixelRatio(),J.getSize(y),!(M&&("createProjectionLayer"in XRWebGLBinding.prototype))){let b8={antialias:O.antialias,alpha:!0,depth:O.depth,stencil:O.stencil,framebufferScaleFactor:W};N=new XRWebGLLayer(Z,Q,b8),Z.updateRenderState({baseLayer:N}),J.setPixelRatio(1),J.setSize(N.framebufferWidth,N.framebufferHeight,!1),V=new c6(N.framebufferWidth,N.framebufferHeight,{format:Q7,type:J7,colorSpace:J.outputColorSpace,stencilBuffer:O.stencil,resolveDepthBuffer:N.ignoreDepthValues===!1,resolveStencilBuffer:N.ignoreDepthValues===!1,storeMultisampledDepthBuffer:N.ignoreDepthValues===!1,storeMultisampledStencilBuffer:N.ignoreDepthValues===!1})}else{let b8=null,n=null,d=null;if(O.depth)d=O.stencil?Q.DEPTH24_STENCIL8:Q.DEPTH_COMPONENT24,b8=O.stencil?b7:y9,n=O.stencil?r7:f7;let P={colorFormat:Q.RGBA8,depthFormat:d,scaleFactor:W};X=this.getBinding(),G=X.createProjectionLayer(P),Z.updateRenderState({layers:[G]}),J.setPixelRatio(1),J.setSize(G.textureWidth,G.textureHeight,!1),V=new c6(G.textureWidth,G.textureHeight,{format:Q7,type:J7,depthTexture:new x7(G.textureWidth,G.textureHeight,n,void 0,void 0,void 0,void 0,void 0,void 0,b8),stencilBuffer:O.stencil,colorSpace:J.outputColorSpace,samples:O.antialias?4:0,resolveDepthBuffer:G.ignoreDepthValues===!1,resolveStencilBuffer:G.ignoreDepthValues===!1,storeMultisampledDepthBuffer:G.ignoreDepthValues===!1,storeMultisampledStencilBuffer:G.ignoreDepthValues===!1})}V.isXRRenderTarget=!0,this.setFoveation(H),U=null,q=await Z.requestReferenceSpace(K),v8.setContext(Z),v8.start(),$.isPresenting=!0,$.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(Z!==null)return Z.environmentBlendMode},this.getDepthTexture=function(){return L.getDepthTexture()};function S(U8){for(let M8=0;M8<U8.removed.length;M8++){let b8=U8.removed[M8],n=w.indexOf(b8);if(n>=0)w[n]=null,B[n].disconnect(b8)}for(let M8=0;M8<U8.added.length;M8++){let b8=U8.added[M8],n=w.indexOf(b8);if(n===-1){for(let P=0;P<B.length;P++)if(P>=w.length){w.push(b8),n=P;break}else if(w[P]===null){w[P]=b8,n=P;break}if(n===-1)break}let d=B[n];if(d)d.connect(b8)}}function B8(U8,M8){if(M8===null)U8.matrixWorld.copy(U8.matrix);else U8.matrixWorld.multiplyMatrices(M8.matrixWorld,U8.matrix);U8.matrixWorldInverse.copy(U8.matrixWorld).invert()}this.updateCamera=function(U8){if(Z===null)return;let{near:M8,far:b8}=U8;if(L.texture!==null){if(L.depthNear>0)M8=L.depthNear;if(L.depthFar>0)b8=L.depthFar}if(J8.near=t.near=m.near=M8,J8.far=t.far=m.far=b8,E8!==J8.near||T!==J8.far)Z.updateRenderState({depthNear:J8.near,depthFar:J8.far}),E8=J8.near,T=J8.far;J8.layers.mask=U8.layers.mask|6,m.layers.mask=J8.layers.mask&-5,t.layers.mask=J8.layers.mask&-3;let n=U8.parent,d=J8.cameras;B8(J8,n);for(let P=0;P<d.length;P++)B8(d[P],n);if(J8.projectionMatrix.copy(m.projectionMatrix),J8.projectionMatrixInverse.copy(m.projectionMatrixInverse),z===null&&U8.isPerspectiveCamera)z={camera:U8,fov:U8.fov,zoom:U8.zoom};i(U8,J8,n)};function i(U8,M8,b8){if(b8===null)U8.matrix.copy(M8.matrixWorld);else U8.matrix.copy(b8.matrixWorld),U8.matrix.invert(),U8.matrix.multiply(M8.matrixWorld);if(U8.matrix.decompose(U8.position,U8.quaternion,U8.scale),U8.updateMatrixWorld(!0),U8.projectionMatrix.copy(M8.projectionMatrix),U8.projectionMatrixInverse.copy(M8.projectionMatrixInverse),U8.isPerspectiveCamera)U8.fov=_9*2*Math.atan(1/U8.projectionMatrix.elements[5]),U8.zoom=1}this.getCamera=function(){return J8},this.getFoveation=function(){if(G===null&&N===null)return;return H},this.setFoveation=function(U8){if(H=U8,G!==null)G.fixedFoveation=U8;if(N!==null&&N.fixedFoveation!==void 0)N.fixedFoveation=U8},this.hasDepthSensing=function(){return L.texture!==null},this.getDepthSensingMesh=function(){return L.getMesh(J8)},this.getCameraTexture=function(U8){return E[U8]};let X8=null;function V8(U8,M8){if(Y=M8.getViewerPose(U||q),F=M8,Y!==null){let b8=Y.views;if(N!==null)J.setRenderTargetFramebuffer(V,N.framebuffer),J.setRenderTarget(V);let n=!1;if(b8.length!==J8.cameras.length)J8.cameras.length=0,n=!0;for(let g=0;g<b8.length;g++){let K8=b8[g],D8=null;if(N!==null)D8=N.getViewport(K8);else{let l=X.getViewSubImage(G,K8);if(D8=l.viewport,g===0)J.setRenderTargetTextures(V,l.colorTexture,l.depthStencilTexture),J.setRenderTarget(V)}let A=v[g];if(A===void 0)A=new x6,A.layers.enable(g),A.viewport=new R6,v[g]=A;if(A.matrix.fromArray(K8.transform.matrix),A.matrix.decompose(A.position,A.quaternion,A.scale),A.projectionMatrix.fromArray(K8.projectionMatrix),A.projectionMatrixInverse.copy(A.projectionMatrix).invert(),A.viewport.set(D8.x,D8.y,D8.width,D8.height),g===0)J8.matrix.copy(A.matrix),J8.matrix.decompose(J8.position,J8.quaternion,J8.scale);if(n===!0)J8.cameras.push(A)}let d=Z.enabledFeatures;if(d&&d.includes("depth-sensing")&&Z.depthUsage=="gpu-optimized"&&M){X=$.getBinding();let g=X.getDepthInformation(b8[0]);if(g&&g.isValid&&g.texture)L.init(g,Z.renderState)}if(d&&d.includes("camera-access")&&M){J.state.unbindTexture(),X=$.getBinding();for(let g=0;g<b8.length;g++){let K8=b8[g].camera;if(K8){let D8=E[K8];if(!D8)D8=new M5,E[K8]=D8;let A=X.getCameraImage(K8);D8.sourceTexture=A}}}}for(let b8=0;b8<B.length;b8++){let n=w[b8],d=B[b8];if(n!==null&&d!==void 0)d.update(n,M8,U||q)}if(X8)X8(U8,M8);if(M8.detectedPlanes)$.dispatchEvent({type:"planesdetected",data:M8});F=null}let v8=new AZ;v8.setAnimationLoop(V8),this.setAnimationLoop=function(U8){X8=U8},this.dispose=function(){}}}var ZX=new G6,lZ=new i8;lZ.set(-1,0,0,0,1,0,0,0,1);function WX(J,Q){function $(E,O){if(E.matrixAutoUpdate===!0)E.updateMatrix();O.value.copy(E.matrix)}function Z(E,O){if(O.color.getRGB(E.fogColor.value,SJ(J)),O.isFog)E.fogNear.value=O.near,E.fogFar.value=O.far;else if(O.isFogExp2)E.fogDensity.value=O.density}function W(E,O,_,V,B){if(O.isNodeMaterial)O.uniformsNeedUpdate=!1;else if(O.isMeshBasicMaterial)q(E,O);else if(O.isMeshLambertMaterial){if(q(E,O),O.envMap)E.envMapIntensity.value=O.envMapIntensity}else if(O.isMeshToonMaterial)q(E,O),G(E,O);else if(O.isMeshPhongMaterial){if(q(E,O),X(E,O),O.envMap)E.envMapIntensity.value=O.envMapIntensity}else if(O.isMeshStandardMaterial){if(q(E,O),N(E,O),O.isMeshPhysicalMaterial)F(E,O,B)}else if(O.isMeshMatcapMaterial)q(E,O),M(E,O);else if(O.isMeshDepthMaterial)q(E,O);else if(O.isMeshDistanceMaterial)q(E,O),L(E,O);else if(O.isMeshNormalMaterial)q(E,O);else if(O.isLineBasicMaterial){if(K(E,O),O.isLineDashedMaterial)H(E,O)}else if(O.isPointsMaterial)U(E,O,_,V);else if(O.isSpriteMaterial)Y(E,O);else if(O.isShadowMaterial)E.color.value.copy(O.color),E.opacity.value=O.opacity;else if(O.isShaderMaterial)O.uniformsNeedUpdate=!1}function q(E,O){if(E.opacity.value=O.opacity,O.color)E.diffuse.value.copy(O.color);if(O.emissive)E.emissive.value.copy(O.emissive).multiplyScalar(O.emissiveIntensity);if(O.map)E.map.value=O.map,$(O.map,E.mapTransform);if(O.alphaMap)E.alphaMap.value=O.alphaMap,$(O.alphaMap,E.alphaMapTransform);if(O.bumpMap){if(E.bumpMap.value=O.bumpMap,$(O.bumpMap,E.bumpMapTransform),E.bumpScale.value=O.bumpScale,O.side===f6)E.bumpScale.value*=-1}if(O.normalMap){if(E.normalMap.value=O.normalMap,$(O.normalMap,E.normalMapTransform),E.normalScale.value.copy(O.normalScale),O.side===f6)E.normalScale.value.negate()}if(O.displacementMap)E.displacementMap.value=O.displacementMap,$(O.displacementMap,E.displacementMapTransform),E.displacementScale.value=O.displacementScale,E.displacementBias.value=O.displacementBias;if(O.emissiveMap)E.emissiveMap.value=O.emissiveMap,$(O.emissiveMap,E.emissiveMapTransform);if(O.specularMap)E.specularMap.value=O.specularMap,$(O.specularMap,E.specularMapTransform);if(O.alphaTest>0)E.alphaTest.value=O.alphaTest;let _=Q.get(O),V=_.envMap,B=_.envMapRotation;if(V){if(E.envMap.value=V,E.envMapRotation.value.setFromMatrix4(ZX.makeRotationFromEuler(B)).transpose(),V.isCubeTexture&&V.isRenderTargetTexture===!1)E.envMapRotation.value.premultiply(lZ);E.reflectivity.value=O.reflectivity,E.ior.value=O.ior,E.refractionRatio.value=O.refractionRatio}if(O.lightMap)E.lightMap.value=O.lightMap,E.lightMapIntensity.value=O.lightMapIntensity,$(O.lightMap,E.lightMapTransform);if(O.aoMap)E.aoMap.value=O.aoMap,E.aoMapIntensity.value=O.aoMapIntensity,$(O.aoMap,E.aoMapTransform)}function K(E,O){if(E.diffuse.value.copy(O.color),E.opacity.value=O.opacity,O.map)E.map.value=O.map,$(O.map,E.mapTransform)}function H(E,O){E.dashSize.value=O.dashSize,E.totalSize.value=O.dashSize+O.gapSize,E.scale.value=O.scale}function U(E,O,_,V){if(E.diffuse.value.copy(O.color),E.opacity.value=O.opacity,E.size.value=O.size*_,E.scale.value=V*0.5,O.map)E.map.value=O.map,$(O.map,E.uvTransform);if(O.alphaMap)E.alphaMap.value=O.alphaMap,$(O.alphaMap,E.alphaMapTransform);if(O.alphaTest>0)E.alphaTest.value=O.alphaTest}function Y(E,O){if(E.diffuse.value.copy(O.color),E.opacity.value=O.opacity,E.rotation.value=O.rotation,O.map)E.map.value=O.map,$(O.map,E.mapTransform);if(O.alphaMap)E.alphaMap.value=O.alphaMap,$(O.alphaMap,E.alphaMapTransform);if(O.alphaTest>0)E.alphaTest.value=O.alphaTest}function X(E,O){E.specular.value.copy(O.specular),E.shininess.value=Math.max(O.shininess,0.0001)}function G(E,O){if(O.gradientMap)E.gradientMap.value=O.gradientMap}function N(E,O){if(E.metalness.value=O.metalness,O.metalnessMap)E.metalnessMap.value=O.metalnessMap,$(O.metalnessMap,E.metalnessMapTransform);if(E.roughness.value=O.roughness,O.roughnessMap)E.roughnessMap.value=O.roughnessMap,$(O.roughnessMap,E.roughnessMapTransform);if(O.envMap)E.envMapIntensity.value=O.envMapIntensity}function F(E,O,_){if(E.ior.value=O.ior,O.diffuseRoughness>0){if(E.diffuseRoughness.value=O.diffuseRoughness,O.diffuseRoughnessMap)E.diffuseRoughnessMap.value=O.diffuseRoughnessMap,$(O.diffuseRoughnessMap,E.diffuseRoughnessMapTransform)}if(O.sheen>0){if(E.sheenColor.value.copy(O.sheenColor).multiplyScalar(O.sheen),E.sheenRoughness.value=O.sheenRoughness,O.sheenColorMap)E.sheenColorMap.value=O.sheenColorMap,$(O.sheenColorMap,E.sheenColorMapTransform);if(O.sheenRoughnessMap)E.sheenRoughnessMap.value=O.sheenRoughnessMap,$(O.sheenRoughnessMap,E.sheenRoughnessMapTransform)}if(O.clearcoat>0){if(E.clearcoat.value=O.clearcoat,E.clearcoatRoughness.value=O.clearcoatRoughness,O.clearcoatMap)E.clearcoatMap.value=O.clearcoatMap,$(O.clearcoatMap,E.clearcoatMapTransform);if(O.clearcoatRoughnessMap)E.clearcoatRoughnessMap.value=O.clearcoatRoughnessMap,$(O.clearcoatRoughnessMap,E.clearcoatRoughnessMapTransform);if(O.clearcoatNormalMap){if(E.clearcoatNormalMap.value=O.clearcoatNormalMap,$(O.clearcoatNormalMap,E.clearcoatNormalMapTransform),E.clearcoatNormalScale.value.copy(O.clearcoatNormalScale),O.side===f6)E.clearcoatNormalScale.value.negate()}}if(O.dispersion>0)E.dispersion.value=O.dispersion;if(O.retroreflectivity>0)E.retroreflectivity.value=O.retroreflectivity;if(O.iridescence>0){if(E.iridescence.value=O.iridescence,E.iridescenceIOR.value=O.iridescenceIOR,E.iridescenceThicknessMinimum.value=O.iridescenceThicknessMinimum,E.iridescenceThicknessMaximum.value=O.iridescenceThicknessMaximum,O.iridescenceMap)E.iridescenceMap.value=O.iridescenceMap,$(O.iridescenceMap,E.iridescenceMapTransform);if(O.iridescenceThicknessMap)E.iridescenceThicknessMap.value=O.iridescenceThicknessMap,$(O.iridescenceThicknessMap,E.iridescenceThicknessMapTransform)}if(O.transmission>0){if(E.transmission.value=O.transmission,E.transmissionSamplerMap.value=_.texture,E.transmissionSamplerSize.value.set(_.width,_.height),O.transmissionMap)E.transmissionMap.value=O.transmissionMap,$(O.transmissionMap,E.transmissionMapTransform);if(E.thickness.value=O.thickness,O.thicknessMap)E.thicknessMap.value=O.thicknessMap,$(O.thicknessMap,E.thicknessMapTransform);E.attenuationDistance.value=O.attenuationDistance,E.attenuationColor.value.copy(O.attenuationColor)}if(O.anisotropy>0){if(E.anisotropyVector.value.set(O.anisotropy*Math.cos(O.anisotropyRotation),O.anisotropy*Math.sin(O.anisotropyRotation)),O.anisotropyMap)E.anisotropyMap.value=O.anisotropyMap,$(O.anisotropyMap,E.anisotropyMapTransform)}if(E.specularIntensity.value=O.specularIntensity,E.specularColor.value.copy(O.specularColor),O.specularColorMap)E.specularColorMap.value=O.specularColorMap,$(O.specularColorMap,E.specularColorMapTransform);if(O.specularIntensityMap)E.specularIntensityMap.value=O.specularIntensityMap,$(O.specularIntensityMap,E.specularIntensityMapTransform)}function M(E,O){if(O.matcap)E.matcap.value=O.matcap}function L(E,O){let _=Q.get(O).light;E.referencePosition.value.setFromMatrixPosition(_.matrixWorld),E.nearDistance.value=_.shadow.camera.near,E.farDistance.value=_.shadow.camera.far}return{refreshFogUniforms:Z,refreshMaterialUniforms:W}}function qX(J,Q,$,Z){let W={},q={};function K(_,V){let B=V.program;Z.uniformBlockBinding(_,B,W[_.id])}function H(_,V){let B=W[_.id];if(B===void 0)M(_),B=U(_),W[_.id]=B,_.addEventListener("dispose",E);let w=V.program;Z.updateUBOMapping(_,w);let y=Q.render.frame;if(q[_.id]!==y)Y(_),q[_.id]=y}function U(_){let V=J.createBuffer(),B=_.__size,w=_.usage;return J.bindBuffer(J.UNIFORM_BUFFER,V),J.bufferData(J.UNIFORM_BUFFER,B,w),J.bindBuffer(J.UNIFORM_BUFFER,null),V}function Y(_){let V=W[_.id],B=_.uniforms,w=_.__cache;J.bindBuffer(J.UNIFORM_BUFFER,V);for(let y=0,D=B.length;y<D;y++){let z=B[y];if(Array.isArray(z))for(let m=0,t=z.length;m<t;m++)X(z[m],y,m,w);else X(z,y,0,w)}J.bindBuffer(J.UNIFORM_BUFFER,null)}function X(_,V,B,w){if(N(_,V,B,w)===!0){let{__offset:y,value:D}=_;if(Array.isArray(D)){let z=0;for(let m=0;m<D.length;m++){let t=D[m],v=L(t,!0);G(t,_.__data,z),z+=v.storage/Float32Array.BYTES_PER_ELEMENT}}else G(D,_.__data,0);J.bufferSubData(J.UNIFORM_BUFFER,y,_.__data)}}function G(_,V,B){if(typeof _==="number"||typeof _==="boolean")V[B]=_;else if(_.isMatrix3)V[B]=_.elements[0],V[B+1]=_.elements[1],V[B+2]=_.elements[2],V[B+3]=0,V[B+4]=_.elements[3],V[B+5]=_.elements[4],V[B+6]=_.elements[5],V[B+7]=0,V[B+8]=_.elements[6],V[B+9]=_.elements[7],V[B+10]=_.elements[8],V[B+11]=0;else if(ArrayBuffer.isView(_))V.set(_.subarray(0,V.length-B),B);else _.toArray(V,B)}function N(_,V,B,w){let y=_.value,D=V+"_"+B;if(Array.isArray(y)){if(w[D]===void 0)w[D]=[];let z=w[D],m=!1;for(let t=0;t<y.length;t++)if(F(y[t],z,t)===!0)m=!0;return m}return F(y,w,D)}function F(_,V,B){if(V[B]===void 0){if(typeof _==="number"||typeof _==="boolean")V[B]=_;else if(ArrayBuffer.isView(_))V[B]=_.slice();else V[B]=_.clone();return!0}else{let w=V[B];if(typeof _==="number"||typeof _==="boolean"){if(w!==_)return V[B]=_,!0}else if(ArrayBuffer.isView(_))return!0;else if(w.equals(_)===!1)return w.copy(_),!0}return!1}function M(_){let V=_.uniforms,B=0,w=16;for(let D=0,z=V.length;D<z;D++){let m=Array.isArray(V[D])?V[D]:[V[D]];for(let t=0,v=m.length;t<v;t++){let J8=m[t],E8=Array.isArray(J8.value)?J8.value:[J8.value],T=Array.isArray(V[D])||Array.isArray(J8.value),H8=B;for(let S=0,B8=E8.length;S<B8;S++){let i=E8[S],X8=L(i,T),V8=B%w,v8=V8%X8.boundary,U8=V8+v8;if(B+=v8,U8!==0&&w-U8<X8.storage)B+=w-U8;if(S===0)H8=B;B+=X8.storage}let e=J8.type==="int"?Int32Array:J8.type==="uint"?Uint32Array:Float32Array;J8.__data=new e((B-H8)/Float32Array.BYTES_PER_ELEMENT),J8.__offset=H8}}let y=B%w;if(y>0)B+=w-y;return _.__size=B,_.__cache={},this}function L(_,V){let B={boundary:0,storage:0};if(typeof _==="number"||typeof _==="boolean")B.boundary=4,B.storage=4;else if(_.isVector2)B.boundary=8,B.storage=8;else if(_.isVector3||_.isColor)B.boundary=16,B.storage=12;else if(_.isVector4)B.boundary=16,B.storage=16;else if(_.isMatrix3)B.boundary=16,B.storage=48;else if(_.isMatrix4)B.boundary=16,B.storage=64;else if(_.isTexture)t8("WebGLRenderer: Texture samplers can not be part of an uniforms group.");else if(ArrayBuffer.isView(_))B.boundary=16,B.storage=_.byteLength;else t8("WebGLRenderer: Unsupported uniform value type.",_);if(V===!0)B.boundary=16,B.storage=Math.ceil(B.storage/16)*16;return B}function E(_){let V=_.target;V.removeEventListener("dispose",E),J.deleteBuffer(W[V.id]),delete W[V.id],delete q[V.id]}function O(){for(let _ in W)J.deleteBuffer(W[_]);W={},q={}}return{bind:K,update:H,dispose:O}}var KX=new Uint16Array([12469,15057,12620,14925,13266,14620,13807,14376,14323,13990,14545,13625,14713,13328,14840,12882,14931,12528,14996,12233,15039,11829,15066,11525,15080,11295,15085,10976,15082,10705,15073,10495,13880,14564,13898,14542,13977,14430,14158,14124,14393,13732,14556,13410,14702,12996,14814,12596,14891,12291,14937,11834,14957,11489,14958,11194,14943,10803,14921,10506,14893,10278,14858,9960,14484,14039,14487,14025,14499,13941,14524,13740,14574,13468,14654,13106,14743,12678,14818,12344,14867,11893,14889,11509,14893,11180,14881,10751,14852,10428,14812,10128,14765,9754,14712,9466,14764,13480,14764,13475,14766,13440,14766,13347,14769,13070,14786,12713,14816,12387,14844,11957,14860,11549,14868,11215,14855,10751,14825,10403,14782,10044,14729,9651,14666,9352,14599,9029,14967,12835,14966,12831,14963,12804,14954,12723,14936,12564,14917,12347,14900,11958,14886,11569,14878,11247,14859,10765,14828,10401,14784,10011,14727,9600,14660,9289,14586,8893,14508,8533,15111,12234,15110,12234,15104,12216,15092,12156,15067,12010,15028,11776,14981,11500,14942,11205,14902,10752,14861,10393,14812,9991,14752,9570,14682,9252,14603,8808,14519,8445,14431,8145,15209,11449,15208,11451,15202,11451,15190,11438,15163,11384,15117,11274,15055,10979,14994,10648,14932,10343,14871,9936,14803,9532,14729,9218,14645,8742,14556,8381,14461,8020,14365,7603,15273,10603,15272,10607,15267,10619,15256,10631,15231,10614,15182,10535,15118,10389,15042,10167,14963,9787,14883,9447,14800,9115,14710,8665,14615,8318,14514,7911,14411,7507,14279,7198,15314,9675,15313,9683,15309,9712,15298,9759,15277,9797,15229,9773,15166,9668,15084,9487,14995,9274,14898,8910,14800,8539,14697,8234,14590,7790,14479,7409,14367,7067,14178,6621,15337,8619,15337,8631,15333,8677,15325,8769,15305,8871,15264,8940,15202,8909,15119,8775,15022,8565,14916,8328,14804,8009,14688,7614,14569,7287,14448,6888,14321,6483,14088,6171,15350,7402,15350,7419,15347,7480,15340,7613,15322,7804,15287,7973,15229,8057,15148,8012,15046,7846,14933,7611,14810,7357,14682,7069,14552,6656,14421,6316,14251,5948,14007,5528,15356,5942,15356,5977,15353,6119,15348,6294,15332,6551,15302,6824,15249,7044,15171,7122,15070,7050,14949,6861,14818,6611,14679,6349,14538,6067,14398,5651,14189,5311,13935,4958,15359,4123,15359,4153,15356,4296,15353,4646,15338,5160,15311,5508,15263,5829,15188,6042,15088,6094,14966,6001,14826,5796,14678,5543,14527,5287,14377,4985,14133,4586,13869,4257,15360,1563,15360,1642,15358,2076,15354,2636,15341,3350,15317,4019,15273,4429,15203,4732,15105,4911,14981,4932,14836,4818,14679,4621,14517,4386,14359,4156,14083,3795,13808,3437,15360,122,15360,137,15358,285,15355,636,15344,1274,15322,2177,15281,2765,15215,3223,15120,3451,14995,3569,14846,3567,14681,3466,14511,3305,14344,3121,14037,2800,13753,2467,15360,0,15360,1,15359,21,15355,89,15346,253,15325,479,15287,796,15225,1148,15133,1492,15008,1749,14856,1882,14685,1886,14506,1783,14324,1608,13996,1398,13702,1183]),N7=null;function HX(){if(N7===null)N7=new h9(KX,16,16,t7,G7),N7.name="DFG_LUT",N7.minFilter=u6,N7.magFilter=u6,N7.wrapS=j9,N7.wrapT=j9,N7.generateMipmaps=!1,N7.needsUpdate=!0;return N7}class rJ{constructor(J={}){let{canvas:Q=x$(),context:$=null,depth:Z=!0,stencil:W=!1,alpha:q=!1,antialias:K=!1,premultipliedAlpha:H=!0,preserveDrawingBuffer:U=!1,powerPreference:Y="default",failIfMajorPerformanceCaveat:X=!1,reversedDepthBuffer:G=!1,outputBufferType:N=J7}=J;this.isWebGLRenderer=!0;let F;if($!==null){if(typeof WebGLRenderingContext<"u"&&$ instanceof WebGLRenderingContext)throw Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");F=$.getContextAttributes().alpha}else F=q;let M=N,L=new Set([S1,T1,w1]),E=new Set([J7,f7,X0,r7,C1,P1]),O=new Uint32Array(4),_=new Int32Array(4),V={textures:[],min:[],max:[],resolution:[]},B=null,w=null,y=[],D=[],z=null;this.domElement=Q,this.debug={checkShaderErrors:!0,diagnostics:{keywords:!1},onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=X7,this.toneMappingExposure=1,this.transmissionResolutionScale=1;let m=this,t=!1,v=null,J8=null,E8=null,T=null;this._outputColorSpace=v9;let H8=0,e=0,S=null,B8=-1,i=null,X8=new R6,V8=new R6,v8=null,U8=new r8(0),M8=0,b8=Q.width,n=Q.height,d=1,P=null,C=null,g=new R6(0,0,b8,n),K8=new R6(0,0,b8,n),D8=!1,A=new i7,l=new F5,j=!1,o=!1,s=new G6,q8=new u,N8=new R6,h={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0},x=!1;function k8(){return S===null?d:1}let f=$;function Y8(k,p){return Q.getContext(k,p)}let Z8,A8,Q8,m8,f8,j8,l8,I,R,c,z8,R8,I8,P8,W8,O8,w8,b,F8,G8,_8,C8,y8;try{let k={alpha:!0,depth:Z,stencil:W,antialias:K,premultipliedAlpha:H,preserveDrawingBuffer:U,powerPreference:Y,failIfMajorPerformanceCaveat:X};if("setAttribute"in Q)Q.setAttribute("data-engine",`three.js r${uQ}`);if(Q.addEventListener("webglcontextlost",x8,!1),Q.addEventListener("webglcontextrestored",a8,!1),Q.addEventListener("webglcontextcreationerror",Q6,!1),f===null){if(f=Y8("webgl2",k),f===null)if(Y8("webgl2"))throw Error("THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.");else throw Error("THREE.WebGLRenderer: Error creating WebGL context.")}o8()}catch(k){throw Q.removeEventListener("webglcontextlost",x8,!1),Q.removeEventListener("webglcontextrestored",a8,!1),Q.removeEventListener("webglcontextcreationerror",Q6,!1),e8("WebGLRenderer: "+k.message),k}function o8(){if(Z8=new MU(f),Z8.init(),_8=new JX(f,Z8),A8=new HU(f,Z8,J,_8),Q8=new tY(f,Z8),A8.reversedDepthBuffer&&G)Q8.buffers.depth.setReversed(!0);J8=f.createFramebuffer(),E8=f.createFramebuffer(),T=f.createFramebuffer(),m8=new BU(f),f8=new xY,j8=new eY(f,Z8,Q8,f8,A8,_8,m8),l8=new RU(m),I=new Vq(f),C8=new qU(f,I),R=new kU(f,I,m8,C8),c=new VU(f,R,I,C8,m8),b=new zU(f,A8,j8),W8=new UU(f8),z8=new hY(m,l8,Z8,A8,C8,W8),R8=new WX(m,f8),I8=new pY,P8=new nY(Z8),w8=new WU(m,l8,Q8,c,F,H),O8=new rY(m,c,A8),y8=new qX(f,m8,A8,Q8),F8=new KU(f,Z8,m8),G8=new LU(f,Z8,m8),m8.programs=z8.programs,m.capabilities=A8,m.extensions=Z8,m.properties=f8,m.renderLists=I8,m.shadowMap=O8,m.state=Q8,m.info=m8}if(M!==J7)z=new AU(M,Q.width,Q.height,K,Z,W);let s8=new mZ(m,f);this.xr=s8,this.getContext=function(){return f},this.getContextAttributes=function(){return f.getContextAttributes()},this.forceContextLoss=function(){let k=Z8.get("WEBGL_lose_context");if(k)k.loseContext()},this.forceContextRestore=function(){let k=Z8.get("WEBGL_lose_context");if(k)k.restoreContext()},this.getPixelRatio=function(){return d},this.setPixelRatio=function(k){if(k===void 0)return;d=k,this.setSize(b8,n,!1)},this.getSize=function(k){return k.set(b8,n)},this.setSize=function(k,p,$8=!0){if(s8.isPresenting){t8("WebGLRenderer: Can't change size while VR device is presenting.");return}if(b8=k,n=p,Q.width=Math.floor(k*d),Q.height=Math.floor(p*d),$8===!0)Q.style.width=k+"px",Q.style.height=p+"px";if(z!==null)z.setSize(Q.width,Q.height);this.setViewport(0,0,k,p)},this.getDrawingBufferSize=function(k){return k.set(b8*d,n*d).floor()},this.setDrawingBufferSize=function(k,p,$8){b8=k,n=p,d=$8,Q.width=Math.floor(k*$8),Q.height=Math.floor(p*$8),this.setViewport(0,0,k,p)},this.setEffects=function(k){if(M===J7){e8("WebGLRenderer: setEffects() requires outputBufferType set to HalfFloatType or FloatType.");return}if(k){for(let p=0;p<k.length;p++)if(k[p].isOutputPass===!0){t8("WebGLRenderer: OutputPass is not needed in setEffects(). Tone mapping and color space conversion are applied automatically.");break}}z.setEffects(k||[])},this.getCurrentViewport=function(k){return k.copy(X8)},this.getViewport=function(k){return k.copy(g)},this.setViewport=function(k,p,$8,a){if(k.isVector4)g.set(k.x,k.y,k.z,k.w);else g.set(k,p,$8,a);Q8.viewport(X8.copy(g).multiplyScalar(k8()).round())},this.getScissor=function(k){return k.copy(K8)},this.setScissor=function(k,p,$8,a){if(k.isVector4)K8.set(k.x,k.y,k.z,k.w);else K8.set(k,p,$8,a);Q8.scissor(V8.copy(K8).multiplyScalar(k8()).round())},this.getScissorTest=function(){return D8},this.setScissorTest=function(k){Q8.setScissorTest(D8=k)},this.setOpaqueSort=function(k){P=k},this.setTransparentSort=function(k){C=k},this.getClearColor=function(k){return k.copy(w8.getClearColor())},this.setClearColor=function(){w8.setClearColor(...arguments)},this.getClearAlpha=function(){return w8.getClearAlpha()},this.setClearAlpha=function(){w8.setClearAlpha(...arguments)},this.clear=function(k=!0,p=!0,$8=!0){let a=0;if(k){let r=!1;if(S!==null){let S8=S.texture.format;r=L.has(S8)}if(r){let S8=S.texture.type,d8=E.has(S8),T8=w8.getClearColor(),p8=w8.getClearAlpha(),n8=T8.r,J6=T8.g,W6=T8.b;if(d8)O[0]=n8,O[1]=J6,O[2]=W6,O[3]=p8,f.clearBufferuiv(f.COLOR,0,O);else _[0]=n8,_[1]=J6,_[2]=W6,_[3]=p8,f.clearBufferiv(f.COLOR,0,_)}else a|=f.COLOR_BUFFER_BIT}if(p)a|=f.DEPTH_BUFFER_BIT,this.state.buffers.depth.setMask(!0);if($8)a|=f.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295);if(a!==0)f.clear(a)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.setNodesHandler=function(k){k.setRenderer(this),v=k},this.dispose=function(){Q.removeEventListener("webglcontextlost",x8,!1),Q.removeEventListener("webglcontextrestored",a8,!1),Q.removeEventListener("webglcontextcreationerror",Q6,!1),w8.dispose(),I8.dispose(),P8.dispose(),j8.dispose(),f8.dispose(),l8.dispose(),c.dispose(),R.dispose(),C8.dispose(),y8.dispose(),z8.dispose(),s8.dispose(),s8.removeEventListener("sessionstart",JQ),s8.removeEventListener("sessionend",QQ),p7.stop()};function x8(k){k.preventDefault(),OJ("WebGLRenderer: Context Lost."),t=!0}function a8(){OJ("WebGLRenderer: Context Restored."),t=!1;let k=m8.autoReset,p=O8.enabled,$8=O8.autoUpdate,a=O8.needsUpdate,r=O8.type;o8(),m8.autoReset=k,O8.enabled=p,O8.autoUpdate=$8,O8.needsUpdate=a,O8.type=r}function Q6(k){e8("WebGLRenderer: A WebGL context could not be created. Reason: ",k.statusMessage)}function g8(k){let p=k.target;p.removeEventListener("dispose",g8),X6(p)}function X6(k){A6(k),f8.remove(k)}function A6(k){let p=f8.get(k).programs;if(p!==void 0){if(p.forEach(function($8){z8.releaseProgram($8)}),k.isShaderMaterial)z8.releaseShaderCache(k)}}this.renderBufferDirect=function(k,p,$8,a,r,S8){if(p===null)p=h;let d8=r.isMesh&&r.matrixWorld.determinantAffine()<0,T8=tZ(k,p,$8,a,r);Q8.setMaterial(a,d8);let p8=$8.index,n8=1;if(a.wireframe===!0){if(p8=R.getWireframeAttribute($8),p8===void 0)return;n8=2}let J6=$8.drawRange,W6=$8.attributes.position,u8=J6.start*n8,q6=(J6.start+J6.count)*n8;if(S8!==null)u8=Math.max(u8,S8.start*n8),q6=Math.min(q6,(S8.start+S8.count)*n8);if(p8!==null)u8=Math.max(u8,0),q6=Math.min(q6,p8.count);else if(W6!==void 0&&W6!==null)u8=Math.max(u8,0),q6=Math.min(q6,W6.count);let k6=q6-u8;if(k6<0||k6===1/0)return;C8.setup(r,a,T8,$8,p8);let F6,N6=F8;if(p8!==null)F6=I.get(p8),N6=G8,N6.setIndex(F6);if(r.isMesh)if(a.wireframe===!0)Q8.setLineWidth(a.wireframeLinewidth*k8()),N6.setMode(f.LINES);else N6.setMode(f.TRIANGLES);else if(r.isLine){let S6=a.linewidth;if(S6===void 0)S6=1;if(Q8.setLineWidth(S6*k8()),r.isLineSegments)N6.setMode(f.LINES);else if(r.isLineLoop)N6.setMode(f.LINE_LOOP);else N6.setMode(f.LINE_STRIP)}else if(r.isPoints)N6.setMode(f.POINTS);else if(r.isSprite)N6.setMode(f.TRIANGLES);if(r.isBatchedMesh)if(!Z8.get("WEBGL_multi_draw")){let{_multiDrawStarts:S6,_multiDrawCounts:c8,_multiDrawCount:h6}=r,U6=p8?I.get(p8).bytesPerElement:1,m7=f8.get(a).currentProgram.getUniforms();for(let j6=0;j6<h6;j6++)m7.setValue(f,"_gl_DrawID",j6),N6.render(S6[j6]/U6,c8[j6])}else N6.renderMultiDraw(r._multiDrawStarts,r._multiDrawCounts,r._multiDrawCount);else if(r.isInstancedMesh)N6.renderInstances(u8,k6,r.count);else if($8.isInstancedBufferGeometry){let S6=$8._maxInstanceCount!==void 0?$8._maxInstanceCount:1/0,c8=Math.min($8.instanceCount,S6);N6.renderInstances(u8,k6,c8)}else N6.render(u8,k6)};function F7(k,p,$8,a){if(v!==null&&k.isNodeMaterial)v.setObject(a,k);if(j===!0)W8.setState(k,$8,!1);if(k.transparent===!0&&k.side===m6&&k.forceSinglePass===!1)k.side=f6,k.needsUpdate=!0,d9(k,p,a),k.side=w9,k.needsUpdate=!0,d9(k,p,a),k.side=m6;else d9(k,p,a)}this.compile=function(k,p,$8=null){if($8===null)$8=k;if(v!==null)v.renderStart(k,p,$8);if(w=P8.get($8),w.init(p),D.push(w),$8.traverseVisible(function(r){if(r.isLight&&r.layers.test(p.layers)){if(w.pushLight(r),r.castShadow)w.pushShadow(r)}}),k!==$8)k.traverseVisible(function(r){if(r.isLight&&r.layers.test(p.layers)){if(w.pushLight(r),r.castShadow)w.pushShadow(r)}});if(w.setupLights(),v!==null)v.updateLights(w.state.lightsArray);if(o=this.localClippingEnabled,j=W8.init(this.clippingPlanes,o),j===!0)W8.setGlobalState(this.clippingPlanes,p);if(v!==null)O8.render(w.state.shadowsArray,$8,p);let a=new Set;if(k.traverse(function(r){if(!(r.isMesh||r.isPoints||r.isLine||r.isSprite))return;let S8=r.material;if(S8)if(Array.isArray(S8))for(let d8=0;d8<S8.length;d8++){let T8=S8[d8];F7(T8,$8,p,r),a.add(T8)}else F7(S8,$8,p,r),a.add(S8)}),w=D.pop(),v!==null)v.renderEnd();return a},this.compileAsync=function(k,p,$8=null){let a=this.compile(k,p,$8);return new Promise((r)=>{function S8(){if(a.forEach(function(d8){let p8=f8.get(d8).currentProgram;if(p8===void 0||p8.isReady())a.delete(d8)}),a.size===0){r(k);return}setTimeout(S8,10)}if(Z8.get("KHR_parallel_shader_compile")!==null)S8();else setTimeout(S8,10)})};let p5=null;function aZ(k){if(p5)p5(k)}function JQ(){p7.stop()}function QQ(){p7.start()}let p7=new AZ;if(p7.setAnimationLoop(aZ),typeof self<"u")p7.setContext(self);this.setAnimationLoop=function(k){p5=k,s8.setAnimationLoop(k),k===null?p7.stop():p7.start()},s8.addEventListener("sessionstart",JQ),s8.addEventListener("sessionend",QQ),this.render=function(k,p){if(p!==void 0&&p.isCamera!==!0){e8("WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(t===!0)return;if(v!==null)v.renderStart(k,p);let $8=s8.enabled===!0&&s8.isPresenting===!0,a=z!==null&&(S===null||$8)&&z.begin(m,S);if(k.matrixWorldAutoUpdate===!0)k.updateMatrixWorld();if(p.parent===null&&p.matrixWorldAutoUpdate===!0)p.updateMatrixWorld();if(s8.enabled===!0&&s8.isPresenting===!0&&(z===null||z.isCompositing()===!1)){if(s8.cameraAutoUpdate===!0)s8.updateCamera(p);p=s8.getCamera()}if(k.isScene===!0)k.onBeforeRender(m,k,p,S);if(w=P8.get(k,D.length),w.init(p),w.state.textureUnits=j8.getTextureUnits(),D.push(w),s.multiplyMatrices(p.projectionMatrix,p.matrixWorldInverse),p.isArrayCamera)l.setFromArrayCamera(p);else A.setFromProjectionMatrix(s,DJ,p.reversedDepth);if(o=this.localClippingEnabled,j=W8.init(this.clippingPlanes,o),B=I8.get(k,y.length),B.init(),y.push(B),this.info.render.frame++,s8.enabled===!0&&s8.isPresenting===!0){let d8=m.xr.getDepthSensingMesh();if(d8!==null)m5(d8,p,-1/0,m.sortObjects)}if(m5(k,p,0,m.sortObjects),B.finish(),v!==null)v.updateLights(w.state.lightsArray);if(m.sortObjects===!0)B.sort(P,C);if(x=s8.enabled===!1||s8.isPresenting===!1||s8.hasDepthSensing()===!1,x)w8.addToRenderList(B,k);if(this.info.autoReset===!0)this.info.reset();if(j===!0)W8.beginShadows();let r=w.state.shadowsArray;if(O8.render(r,k,p),j===!0)W8.endShadows();if((a&&z.hasRenderPass())===!1){let{opaque:d8,transmissive:T8}=B;if(w.setupLights(),p.isArrayCamera){let p8=p.cameras;if(T8.length>0)for(let n8=0,J6=p8.length;n8<J6;n8++){let W6=p8[n8];ZQ(d8,T8,k,W6)}if(x)w8.render(k);for(let n8=0,J6=p8.length;n8<J6;n8++){let W6=p8[n8];$Q(B,k,W6,W6.viewport)}}else{if(T8.length>0)ZQ(d8,T8,k,p);if(x)w8.render(k);$Q(B,k,p)}}if(S!==null&&e===0)j8.updateMultisampleRenderTarget(S),j8.updateRenderTargetMipmap(S);if(a)z.end(m);if(k.isScene===!0)k.onAfterRender(m,k,p);if(C8.resetDefaultState(),B8=-1,i=null,D.pop(),D.length>0){if(w=D[D.length-1],j8.setTextureUnits(w.state.textureUnits),j===!0)W8.setGlobalState(m.clippingPlanes,w.state.camera)}else w=null;if(y.pop(),y.length>0)B=y[y.length-1];else B=null;if(v!==null)v.renderEnd()};function m5(k,p,$8,a){if(k.visible===!1)return;if(k.layers.test(p.layers)){if(k.isGroup)$8=k.renderOrder;else if(k.isLOD){if(k.autoUpdate===!0)k.update(p)}else if(k.isLight){if(w.pushLight(k),k.castShadow)w.pushShadow(k)}else if(k.isSprite){let d8=p.isArrayCamera?l:A;if(!k.frustumCulled||k.intersectsFrustum(d8)){if(a)N8.setFromMatrixPosition(k.matrixWorld).applyMatrix4(s);let T8=c.update(k),p8=k.material;if(p8.visible)B.push(k,T8,p8,$8,N8.z,null,p)}}else if(k.isMesh||k.isLine||k.isPoints){let d8=p.isArrayCamera?l:A;if(!k.frustumCulled||k.intersectsFrustum(d8)){let T8=c.update(k),p8=k.material;if(a){if(k.boundingSphere!==void 0){if(k.boundingSphere===null)k.computeBoundingSphere();N8.copy(k.boundingSphere.center)}else{if(T8.boundingSphere===null)T8.computeBoundingSphere();N8.copy(T8.boundingSphere.center)}N8.applyMatrix4(k.matrixWorld).applyMatrix4(s)}if(Array.isArray(p8)){let n8=T8.groups;for(let J6=0,W6=n8.length;J6<W6;J6++){let u8=n8[J6],q6=p8[u8.materialIndex];if(q6&&q6.visible)B.push(k,T8,q6,$8,N8.z,u8,p)}}else if(p8.visible)B.push(k,T8,p8,$8,N8.z,null,p)}}}let S8=k.children;for(let d8=0,T8=S8.length;d8<T8;d8++)m5(S8[d8],p,$8,a)}function $Q(k,p,$8,a){let{opaque:r,transmissive:S8,transparent:d8}=k;if(w.setupLightsView($8),j===!0)W8.setGlobalState(m.clippingPlanes,$8);if(a)Q8.viewport(X8.copy(a));if(r.length>0)A0(r,p,$8);if(S8.length>0)A0(S8,p,$8);if(d8.length>0)A0(d8,p,$8);Q8.buffers.depth.setTest(!0),Q8.buffers.depth.setMask(!0),Q8.buffers.color.setMask(!0),Q8.setPolygonOffset(!1)}function ZQ(k,p,$8,a){if(($8.isScene===!0?$8.overrideMaterial:null)!==null)return;if(w.state.transmissionRenderTarget[a.id]===void 0){let u8=Z8.has("EXT_color_buffer_half_float")||Z8.has("EXT_color_buffer_float");w.state.transmissionRenderTarget[a.id]=new c6(1,1,{generateMipmaps:!0,type:u8?G7:J7,minFilter:v7,samples:Math.max(4,A8.samples),stencilBuffer:W,resolveDepthBuffer:!1,resolveStencilBuffer:!1,storeMultisampledDepthBuffer:!1,storeMultisampledStencilBuffer:!1,colorSpace:K6.workingColorSpace})}let S8=w.state.transmissionRenderTarget[a.id],d8=a.viewport||X8;S8.setSize(d8.z*m.transmissionResolutionScale,d8.w*m.transmissionResolutionScale);let T8=m.getRenderTarget(),p8=m.getActiveCubeFace(),n8=m.getActiveMipmapLevel();if(m.setRenderTarget(S8),m.getClearColor(U8),M8=m.getClearAlpha(),M8<1)m.setClearColor(16777215,0.5);if(m.clear(),x)w8.render($8);let J6=m.toneMapping;m.toneMapping=X7;let W6=a.viewport;if(a.viewport!==void 0)a.viewport=void 0;if(w.setupLightsView(a),j===!0)W8.setGlobalState(m.clippingPlanes,a);if(A0(k,$8,a),j8.updateMultisampleRenderTarget(S8),j8.updateRenderTargetMipmap(S8),Z8.has("WEBGL_multisampled_render_to_texture")===!1){let u8=!1;for(let q6=0,k6=p.length;q6<k6;q6++){let F6=p[q6],{object:N6,geometry:S6,material:c8,group:h6}=F6;if(c8.side===m6&&N6.layers.test(a.layers)){let U6=c8.side;c8.side=f6,c8.needsUpdate=!0,WQ(N6,$8,a,S6,c8,h6),c8.side=U6,c8.needsUpdate=!0,u8=!0}}if(u8===!0)j8.updateMultisampleRenderTarget(S8),j8.updateRenderTargetMipmap(S8)}if(m.setRenderTarget(T8,p8,n8),m.setClearColor(U8,M8),W6!==void 0)a.viewport=W6;m.toneMapping=J6}function A0(k,p,$8){let a=p.isScene===!0?p.overrideMaterial:null;for(let r=0,S8=k.length;r<S8;r++){let d8=k[r],{object:T8,geometry:p8,group:n8}=d8,J6=d8.material;if(J6.allowOverride===!0&&a!==null)J6=a;if(T8.layers.test($8.layers))WQ(T8,p,$8,p8,J6,n8)}}function WQ(k,p,$8,a,r,S8){if(v!==null&&r.isNodeMaterial)v.setObject(k,r);if(k.onBeforeRender(m,p,$8,a,r,S8),k.modelViewMatrix.multiplyMatrices($8.matrixWorldInverse,k.matrixWorld),k.normalMatrix.getNormalMatrix(k.modelViewMatrix),r.onBeforeRender(m,p,$8,a,k,S8),r.transparent===!0&&r.side===m6&&r.forceSinglePass===!1)r.side=f6,r.needsUpdate=!0,m.renderBufferDirect($8,p,a,r,k,S8),r.side=w9,r.needsUpdate=!0,m.renderBufferDirect($8,p,a,r,k,S8),r.side=m6;else m.renderBufferDirect($8,p,a,r,k,S8);k.onAfterRender(m,p,$8,a,r,S8)}function qQ(k){let p=0;for(let $8 of k)if($8.texture!==null)p++;return p}function d9(k,p,$8){if(p.isScene!==!0)p=h;let a=f8.get(k),r=w.state.lights,S8=w.state.shadowsArray,d8=r.state.version,T8=z8.getParameters(k,r.state,S8,p,$8,w.state.lightProbeGridArray),p8=z8.getProgramCacheKey(T8),n8=a.programs;a.environment=k.isMeshStandardMaterial||k.isMeshLambertMaterial||k.isMeshPhongMaterial?p.environment:null,a.fog=p.fog;let J6=k.isMeshStandardMaterial||k.isMeshLambertMaterial&&!k.envMap||k.isMeshPhongMaterial&&!k.envMap;if(a.envMap=l8.get(k.envMap||a.environment,J6),a.envMapRotation=a.environment!==null&&k.envMap===null?p.environmentRotation:k.envMapRotation,n8===void 0)k.addEventListener("dispose",g8),n8=new Map,a.programs=n8,a.programVariants=new Map;let W6=n8.get(p8);if(W6!==void 0){if(a.currentProgram===W6&&a.lightsStateVersion===d8)return HQ(k,T8),W6}else{if(T8.uniforms=z8.getUniforms(k),v!==null&&k.isNodeMaterial)v.build(k,$8,T8);k.onBeforeCompile(T8,m),W6=z8.acquireProgram(T8,p8),n8.set(p8,W6),a.uniforms=T8.uniforms}let u8=a.uniforms;if(!k.isShaderMaterial&&!k.isRawShaderMaterial||k.clipping===!0)u8.clippingPlanes=W8.uniform;if(HQ(k,T8),a.needsLights=JW(k),a.lightsStateVersion=d8,a.needsLights)u8.ambientLightColor.value=r.state.ambient,u8.lightProbe.value=r.state.probe,u8.sunLights.value=r.state.sun,u8.sunLightShadows.value=r.state.sunShadow,u8.directionalLights.value=r.state.directional,u8.directionalLightShadows.value=r.state.directionalShadow,u8.spotLights.value=r.state.spot,u8.spotLightShadows.value=r.state.spotShadow,u8.rectAreaLights.value=r.state.rectArea,u8.ltc_1.value=r.state.rectAreaLTC1,u8.ltc_2.value=r.state.rectAreaLTC2,u8.pointLights.value=r.state.point,u8.pointLightShadows.value=r.state.pointShadow,u8.hemisphereLights.value=r.state.hemi,u8.sunShadowMatrix.value=r.state.sunShadowMatrix,u8.sunShadowCascade.value=r.state.sunShadowCascade,u8.directionalShadowMatrix.value=r.state.directionalShadowMatrix,u8.spotLightMatrix.value=r.state.spotLightMatrix,u8.spotLightMap.value=r.state.spotLightMap,u8.pointShadowMatrix.value=r.state.pointShadowMatrix;return a.numLightProbeGrids=qQ(w.state.lightProbeGridArray),a.currentProgram=W6,a.uniformsList=null,W6}function rZ(k,p,$8,a,r){let S8=f8.get(k),d8=S8.currentProgram.id+","+a+","+r,T8=S8.programVariants.get(d8);if(T8===void 0)T8=d9(k,p,$8),S8.programVariants.set(d8,T8);else S8.currentProgram=T8,S8.uniformsList=null,S8.outputColorSpace=a,S8.toneMapping=r;return T8}function KQ(k){if(k.uniformsList===null){let p=k.currentProgram.getUniforms();k.uniformsList=k0.seqWithValue(p.seq,k.uniforms)}return k.uniformsList}function HQ(k,p){let $8=f8.get(k);$8.outputColorSpace=p.outputColorSpace,$8.batching=p.batching,$8.batchingColor=p.batchingColor,$8.instancing=p.instancing,$8.instancingColor=p.instancingColor,$8.instancingMorph=p.instancingMorph,$8.skinning=p.skinning,$8.morphTargets=p.morphTargets,$8.morphNormals=p.morphNormals,$8.morphColors=p.morphColors,$8.morphTargetsCount=p.morphTargetsCount,$8.numClippingPlanes=p.numClippingPlanes,$8.numIntersection=p.numClipIntersection,$8.vertexAlphas=p.vertexAlphas,$8.vertexTangents=p.vertexTangents,$8.toneMapping=p.toneMapping}function tZ(k,p,$8,a,r){if(p.isScene!==!0)p=h;j8.resetTextureUnits();let S8=p.fog,d8=a.isMeshStandardMaterial||a.isMeshLambertMaterial||a.isMeshPhongMaterial?p.environment:null,T8=S===null?m.outputColorSpace:S.isXRRenderTarget===!0?S.texture.colorSpace:K6.workingColorSpace,p8=a.isMeshStandardMaterial||a.isMeshLambertMaterial&&!a.envMap||a.isMeshPhongMaterial&&!a.envMap,n8=l8.get(a.envMap||d8,p8),J6=a.vertexColors===!0&&!!$8.attributes.color&&$8.attributes.color.itemSize===4,W6=!!$8.attributes.tangent&&(!!a.normalMap||a.anisotropy>0),u8=!!$8.morphAttributes.position,q6=!!$8.morphAttributes.normal,k6=!!$8.morphAttributes.color,F6=X7;if(a.toneMapped){if(S===null||S.isXRRenderTarget===!0)F6=m.toneMapping}let N6=$8.morphAttributes.position||$8.morphAttributes.normal||$8.morphAttributes.color,S6=N6!==void 0?N6.length:0,c8=f8.get(a),h6=w.state.lights;if(j===!0){if(o===!0||k!==i){let D6=k===i&&a.id===B8;W8.setState(a,k,D6)}}let U6=!1,m7=!1;if(a.version===c8.__version){if(c8.needsLights&&c8.lightsStateVersion!==h6.state.version)U6=!0;else if(r.isBatchedMesh&&c8.batching===!1)U6=!0;else if(!r.isBatchedMesh&&c8.batching===!0)U6=!0;else if(r.isBatchedMesh&&c8.batchingColor===!0&&r._colorsTexture===null)U6=!0;else if(r.isBatchedMesh&&c8.batchingColor===!1&&r._colorsTexture!==null)U6=!0;else if(r.isInstancedMesh&&c8.instancing===!1)U6=!0;else if(!r.isInstancedMesh&&c8.instancing===!0)U6=!0;else if(r.isSkinnedMesh&&c8.skinning===!1)U6=!0;else if(!r.isSkinnedMesh&&c8.skinning===!0)U6=!0;else if(r.isInstancedMesh&&c8.instancingColor===!0&&r.instanceColor===null)U6=!0;else if(r.isInstancedMesh&&c8.instancingColor===!1&&r.instanceColor!==null)U6=!0;else if(r.isInstancedMesh&&c8.instancingMorph===!0&&r.morphTexture===null)U6=!0;else if(r.isInstancedMesh&&c8.instancingMorph===!1&&r.morphTexture!==null)U6=!0;else if(c8.envMap!==n8)U6=!0;else if(a.fog===!0&&c8.fog!==S8)U6=!0;else if(c8.numClippingPlanes!==void 0&&(c8.numClippingPlanes!==W8.numPlanes||c8.numIntersection!==W8.numIntersection))U6=!0;else if(c8.vertexAlphas!==J6)U6=!0;else if(c8.vertexTangents!==W6)U6=!0;else if(c8.morphTargets!==u8)U6=!0;else if(c8.morphNormals!==q6)U6=!0;else if(c8.morphColors!==k6)U6=!0;else if(c8.morphTargetsCount!==S6)U6=!0;else if(c8.numLightProbeGrids!==qQ(w.state.lightProbeGridArray))U6=!0;else if(c8.outputColorSpace!==T8||c8.toneMapping!==F6)m7=!0}else U6=!0,c8.__version=a.version;let j6=c8.currentProgram;if(U6===!0||m7===!0){if(j6=m7===!0?rZ(a,p,r,T8,F6):d9(a,p,r),v&&a.isNodeMaterial)v.onUpdateProgram(a,j6,c8)}let _0=!1,P7=!1,l7=!1,H6=j6.getUniforms(),P6=c8.uniforms;if(Q8.useProgram(j6.program))_0=!0,P7=!0,l7=!0;if(a.id!==B8)B8=a.id,P7=!0;if(_0||i!==k){if(Q8.buffers.depth.getReversed()&&k.reversedDepth!==!0)k._reversedDepth=!0,k.updateProjectionMatrix();H6.setValue(f,"projectionMatrix",k.projectionMatrix),H6.setValue(f,"viewMatrix",k.matrixWorldInverse);let _6=H6.map.cameraPosition;if(_6!==void 0)_6.setValue(f,q8.setFromMatrixPosition(k.matrixWorld));if(A8.logarithmicDepthBuffer)H6.setValue(f,"logDepthBufFC",2/(Math.log(k.far+1)/Math.LN2));if(a.isMeshPhongMaterial||a.isMeshToonMaterial||a.isMeshLambertMaterial||a.isMeshBasicMaterial||a.isMeshStandardMaterial||a.isShaderMaterial)H6.setValue(f,"isOrthographic",k.isOrthographicCamera===!0);if(i!==k)i=k,P7=!0,l7=!0}if(c8.needsLights){if(h6.state.sunShadowMap.length>0)H6.setValue(f,"sunShadowMap",h6.state.sunShadowMap,j8);if(h6.state.directionalShadowMap.length>0)H6.setValue(f,"directionalShadowMap",h6.state.directionalShadowMap,j8);if(h6.state.spotShadowMap.length>0)H6.setValue(f,"spotShadowMap",h6.state.spotShadowMap,j8);if(h6.state.pointShadowMap.length>0)H6.setValue(f,"pointShadowMap",h6.state.pointShadowMap,j8)}if(r.isSkinnedMesh){H6.setOptional(f,r,"bindMatrix"),H6.setOptional(f,r,"bindMatrixInverse");let D6=r.skeleton;if(D6){if(D6.boneTexture===null)D6.computeBoneTexture();H6.setValue(f,"boneTexture",D6.boneTexture,j8)}}if(r.isBatchedMesh){if(H6.setOptional(f,r,"batchingTexture"),H6.setValue(f,"batchingTexture",r._matricesTexture,j8),H6.setOptional(f,r,"batchingIdTexture"),H6.setValue(f,"batchingIdTexture",r._indirectTexture,j8),H6.setOptional(f,r,"batchingColorTexture"),r._colorsTexture!==null)H6.setValue(f,"batchingColorTexture",r._colorsTexture,j8)}let o6=$8.morphAttributes;if(o6.position!==void 0||o6.normal!==void 0||o6.color!==void 0)b.update(r,$8,j6);if(P7||c8.receiveShadow!==r.receiveShadow)c8.receiveShadow=r.receiveShadow,H6.setValue(f,"receiveShadow",r.receiveShadow);if((a.isMeshStandardMaterial||a.isMeshLambertMaterial||a.isMeshPhongMaterial)&&a.envMap===null&&p.environment!==null)P6.envMapIntensity.value=p.environmentIntensity;if(P6.dfgLUT!==void 0)P6.dfgLUT.value=HX();if(P7){if(H6.setValue(f,"toneMappingExposure",m.toneMappingExposure),c8.needsLights)eZ(P6,l7);if(S8&&a.fog===!0)R8.refreshFogUniforms(P6,S8);if(R8.refreshMaterialUniforms(P6,a,d,n,w.state.transmissionRenderTarget[k.id]),c8.needsLights&&c8.numLightProbeGrids>0){let D6=V,_6=0;for(let D7 of w.state.lightProbeGridArray){if(D7.texture===null)continue;D6.textures[_6]=D7.texture,D6.min[_6]=D7.boundingBox.min,D6.max[_6]=D7.boundingBox.max,D6.resolution[_6]=D7.resolution,_6++}for(let D7 in D6)D6[D7].length=_6;P6.probesSH.value=D6.textures,P6.probesMin.value=D6.min,P6.probesMax.value=D6.max,P6.probesResolution.value=D6.resolution}k0.upload(f,KQ(c8),P6,j8)}if(a.isShaderMaterial&&a.uniformsNeedUpdate===!0)k0.upload(f,KQ(c8),P6,j8),a.uniformsNeedUpdate=!1;if(a.isSpriteMaterial)H6.setValue(f,"center",r.center);if(H6.setValue(f,"modelViewMatrix",r.modelViewMatrix),H6.setValue(f,"normalMatrix",r.normalMatrix),H6.setValue(f,"modelMatrix",r.matrixWorld),a.uniformsGroups!==void 0){let D6=a.uniformsGroups;for(let _6=0,D7=D6.length;_6<D7;_6++){let YQ=D6[_6];y8.update(YQ,j6),y8.bind(YQ,j6)}}return j6}function eZ(k,p){k.ambientLightColor.needsUpdate=p,k.lightProbe.needsUpdate=p,k.sunLights.needsUpdate=p,k.sunLightShadows.needsUpdate=p,k.directionalLights.needsUpdate=p,k.directionalLightShadows.needsUpdate=p,k.pointLights.needsUpdate=p,k.pointLightShadows.needsUpdate=p,k.spotLights.needsUpdate=p,k.spotLightShadows.needsUpdate=p,k.rectAreaLights.needsUpdate=p,k.hemisphereLights.needsUpdate=p}function JW(k){return k.isMeshLambertMaterial||k.isMeshToonMaterial||k.isMeshPhongMaterial||k.isMeshStandardMaterial||k.isShadowMaterial||k.isShaderMaterial&&k.lights===!0}this.getActiveCubeFace=function(){return H8},this.getActiveMipmapLevel=function(){return e},this.getRenderTarget=function(){return S},this.setRenderTargetTextures=function(k,p,$8){let a=f8.get(k);if(a.__autoAllocateDepthBuffer=k.resolveDepthBuffer===!1,a.__autoAllocateDepthBuffer===!1)a.__useRenderToTexture=!1;f8.get(k.texture).__webglTexture=p,f8.get(k.depthTexture).__webglTexture=a.__autoAllocateDepthBuffer?void 0:$8,a.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(k,p){let $8=f8.get(k);$8.__webglFramebuffer=p,$8.__useDefaultFramebuffer=p===void 0},this.setRenderTarget=function(k,p=0,$8=0){S=k,H8=p,e=$8;let a=null,r=!1,S8=!1;if(k){let T8=f8.get(k);if(T8.__useDefaultFramebuffer!==void 0){Q8.bindFramebuffer(f.FRAMEBUFFER,T8.__webglFramebuffer),X8.copy(k.viewport),V8.copy(k.scissor),v8=k.scissorTest,Q8.viewport(X8),Q8.scissor(V8),Q8.setScissorTest(v8),B8=-1;return}else if(T8.__webglFramebuffer===void 0)j8.setupRenderTarget(k);else if(T8.__hasExternalTextures)j8.rebindTextures(k,f8.get(k.texture).__webglTexture,f8.get(k.depthTexture).__webglTexture);else if(k.depthBuffer){let J6=k.depthTexture;if(T8.__boundDepthTexture!==J6){if(J6!==null&&f8.has(J6)&&(k.width!==J6.image.width||k.height!==J6.image.height))throw Error("THREE.WebGLRenderer: Attached DepthTexture is initialized to the incorrect size.");j8.setupDepthRenderbuffer(k)}}let p8=k.texture;if(p8.isData3DTexture||p8.isDataArrayTexture||p8.isCompressedArrayTexture)S8=!0;let n8=f8.get(k).__webglFramebuffer;if(k.isWebGLCubeRenderTarget){if(Array.isArray(n8[p]))a=n8[p][$8];else a=n8[p];r=!0}else if(k.samples>0&&j8.useMultisampledRTT(k)===!1)a=f8.get(k).__webglMultisampledFramebuffer;else if(Array.isArray(n8))a=n8[$8];else a=n8;X8.copy(k.viewport),V8.copy(k.scissor),v8=k.scissorTest}else X8.copy(g).multiplyScalar(d).floor(),V8.copy(K8).multiplyScalar(d).floor(),v8=D8;if($8!==0)a=J8;if(Q8.bindFramebuffer(f.FRAMEBUFFER,a))Q8.drawBuffers(k,a);if(Q8.viewport(X8),Q8.scissor(V8),Q8.setScissorTest(v8),r){let T8=f8.get(k.texture);f.framebufferTexture2D(f.FRAMEBUFFER,f.COLOR_ATTACHMENT0,f.TEXTURE_CUBE_MAP_POSITIVE_X+p,T8.__webglTexture,$8)}else if(S8){let T8=p;for(let p8=0;p8<k.textures.length;p8++){let n8=f8.get(k.textures[p8]);f.framebufferTextureLayer(f.FRAMEBUFFER,f.COLOR_ATTACHMENT0+p8,n8.__webglTexture,$8,T8)}}else if(k!==null&&$8!==0){let T8=f8.get(k.texture);f.framebufferTexture2D(f.FRAMEBUFFER,f.COLOR_ATTACHMENT0,f.TEXTURE_2D,T8.__webglTexture,$8)}B8=-1};function UQ(k){let p=f8.get(k);if(p.__readFormat!==k.format||p.__readType!==k.type)p.__readFormat=k.format,p.__readType=k.type,p.__formatReadable=A8.textureFormatReadable(k.format),p.__typeReadable=A8.textureTypeReadable(k.type);return p}if(this.readRenderTargetPixels=function(k,p,$8,a,r,S8,d8,T8=0){if(!(k&&k.isWebGLRenderTarget)){e8("WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let p8=f8.get(k).__webglFramebuffer;if(k.isWebGLCubeRenderTarget&&d8!==void 0){if(p8=p8[d8],Array.isArray(p8))p8=p8[0]}if(p8){Q8.bindFramebuffer(f.FRAMEBUFFER,p8);try{let n8=k.textures[T8],J6=n8.format,W6=n8.type;if(k.textures.length>1)f.readBuffer(f.COLOR_ATTACHMENT0+T8);let u8=UQ(n8);if(u8.__formatReadable===!1){e8("WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(u8.__typeReadable===!1){e8("WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}if(p>=0&&p<=k.width-a&&($8>=0&&$8<=k.height-r))f.readPixels(p,$8,a,r,_8.convert(J6),_8.convert(W6),S8)}finally{let n8=S!==null?f8.get(S).__webglFramebuffer:null;Q8.bindFramebuffer(f.FRAMEBUFFER,n8)}}},this.readRenderTargetPixelsAsync=async function(k,p,$8,a,r,S8,d8,T8=0){if(!(k&&k.isWebGLRenderTarget))throw Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let p8=f8.get(k).__webglFramebuffer;if(k.isWebGLCubeRenderTarget&&d8!==void 0){if(p8=p8[d8],Array.isArray(p8))p8=p8[0]}if(p8)if(p>=0&&p<=k.width-a&&($8>=0&&$8<=k.height-r)){Q8.bindFramebuffer(f.FRAMEBUFFER,p8);let n8=k.textures[T8],J6=n8.format,W6=n8.type;if(k.textures.length>1)f.readBuffer(f.COLOR_ATTACHMENT0+T8);let u8=UQ(n8);if(u8.__formatReadable===!1)throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(u8.__typeReadable===!1)throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");let q6=f.createBuffer();f.bindBuffer(f.PIXEL_PACK_BUFFER,q6),f.bufferData(f.PIXEL_PACK_BUFFER,S8.byteLength,f.STREAM_READ),f.readPixels(p,$8,a,r,_8.convert(J6),_8.convert(W6),0),f.bindBuffer(f.PIXEL_PACK_BUFFER,null);let k6=S!==null?f8.get(S).__webglFramebuffer:null;Q8.bindFramebuffer(f.FRAMEBUFFER,k6);let F6=f.fenceSync(f.SYNC_GPU_COMMANDS_COMPLETE,0);return f.flush(),await p$(f,F6,4),f.bindBuffer(f.PIXEL_PACK_BUFFER,q6),f.getBufferSubData(f.PIXEL_PACK_BUFFER,0,S8),f.bindBuffer(f.PIXEL_PACK_BUFFER,null),f.deleteBuffer(q6),f.deleteSync(F6),S8}else throw Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(k,p=null,$8=0){let a=Math.pow(2,-$8),r=Math.floor(k.image.width*a),S8=Math.floor(k.image.height*a),d8=p!==null?p.x:0,T8=p!==null?p.y:0;j8.setTexture2D(k,0),f.copyTexSubImage2D(f.TEXTURE_2D,$8,0,0,d8,T8,r,S8),Q8.unbindTexture()},this.copyTextureToTexture=function(k,p,$8=null,a=null,r=0,S8=0){let d8,T8,p8,n8,J6,W6,u8,q6,k6,F6=k.isCompressedTexture?k.mipmaps[S8]:k.image;if($8!==null)d8=$8.max.x-$8.min.x,T8=$8.max.y-$8.min.y,p8=$8.isBox3?$8.max.z-$8.min.z:1,n8=$8.min.x,J6=$8.min.y,W6=$8.isBox3?$8.min.z:0;else{let H6=Math.pow(2,-r);if(d8=Math.floor(F6.width*H6),T8=Math.floor(F6.height*H6),k.isDataArrayTexture)p8=F6.depth;else if(k.isData3DTexture)p8=Math.floor(F6.depth*H6);else p8=1;n8=0,J6=0,W6=0}if(a!==null)u8=a.x,q6=a.y,k6=a.z;else u8=0,q6=0,k6=0;let N6=_8.convert(p.format),S6=_8.convert(p.type),c8;if(p.isData3DTexture)j8.setTexture3D(p,0),c8=f.TEXTURE_3D;else if(p.isDataArrayTexture||p.isCompressedArrayTexture)j8.setTexture2DArray(p,0),c8=f.TEXTURE_2D_ARRAY;else j8.setTexture2D(p,0),c8=f.TEXTURE_2D;Q8.activeTexture(f.TEXTURE0),Q8.pixelStorei(f.UNPACK_FLIP_Y_WEBGL,p.flipY),Q8.pixelStorei(f.UNPACK_PREMULTIPLY_ALPHA_WEBGL,p.premultiplyAlpha),Q8.pixelStorei(f.UNPACK_ALIGNMENT,p.unpackAlignment);let h6=Q8.getParameter(f.UNPACK_ROW_LENGTH),U6=Q8.getParameter(f.UNPACK_IMAGE_HEIGHT),m7=Q8.getParameter(f.UNPACK_SKIP_PIXELS),j6=Q8.getParameter(f.UNPACK_SKIP_ROWS),_0=Q8.getParameter(f.UNPACK_SKIP_IMAGES);Q8.pixelStorei(f.UNPACK_ROW_LENGTH,F6.width),Q8.pixelStorei(f.UNPACK_IMAGE_HEIGHT,F6.height),Q8.pixelStorei(f.UNPACK_SKIP_PIXELS,n8),Q8.pixelStorei(f.UNPACK_SKIP_ROWS,J6),Q8.pixelStorei(f.UNPACK_SKIP_IMAGES,W6);let P7=k.isDataArrayTexture||k.isData3DTexture,l7=p.isDataArrayTexture||p.isData3DTexture;if(k.isDepthTexture){let H6=f8.get(k),P6=f8.get(p),o6=f8.get(H6.__renderTarget),D6=f8.get(P6.__renderTarget);Q8.bindFramebuffer(f.READ_FRAMEBUFFER,o6.__webglFramebuffer),Q8.bindFramebuffer(f.DRAW_FRAMEBUFFER,D6.__webglFramebuffer);for(let _6=0;_6<p8;_6++){if(P7)f.framebufferTextureLayer(f.READ_FRAMEBUFFER,f.COLOR_ATTACHMENT0,f8.get(k).__webglTexture,r,W6+_6),f.framebufferTextureLayer(f.DRAW_FRAMEBUFFER,f.COLOR_ATTACHMENT0,f8.get(p).__webglTexture,S8,k6+_6);f.blitFramebuffer(n8,J6,n8+d8,J6+T8,u8,q6,u8+d8,q6+T8,f.DEPTH_BUFFER_BIT,f.NEAREST)}Q8.bindFramebuffer(f.READ_FRAMEBUFFER,null),Q8.bindFramebuffer(f.DRAW_FRAMEBUFFER,null)}else if(r!==0||k.isRenderTargetTexture||f8.has(k)){let H6=f8.get(k),P6=f8.get(p);Q8.bindFramebuffer(f.READ_FRAMEBUFFER,E8),Q8.bindFramebuffer(f.DRAW_FRAMEBUFFER,T);for(let o6=0;o6<p8;o6++){if(P7)f.framebufferTextureLayer(f.READ_FRAMEBUFFER,f.COLOR_ATTACHMENT0,H6.__webglTexture,r,W6+o6);else f.framebufferTexture2D(f.READ_FRAMEBUFFER,f.COLOR_ATTACHMENT0,f.TEXTURE_2D,H6.__webglTexture,r);if(l7)f.framebufferTextureLayer(f.DRAW_FRAMEBUFFER,f.COLOR_ATTACHMENT0,P6.__webglTexture,S8,k6+o6);else f.framebufferTexture2D(f.DRAW_FRAMEBUFFER,f.COLOR_ATTACHMENT0,f.TEXTURE_2D,P6.__webglTexture,S8);if(r!==0)f.blitFramebuffer(n8,J6,n8+d8,J6+T8,u8,q6,u8+d8,q6+T8,f.COLOR_BUFFER_BIT,f.NEAREST);else if(l7)f.copyTexSubImage3D(c8,S8,u8,q6,k6+o6,n8,J6,d8,T8);else f.copyTexSubImage2D(c8,S8,u8,q6,n8,J6,d8,T8)}Q8.bindFramebuffer(f.READ_FRAMEBUFFER,null),Q8.bindFramebuffer(f.DRAW_FRAMEBUFFER,null)}else if(l7)if(k.isDataTexture||k.isData3DTexture)f.texSubImage3D(c8,S8,u8,q6,k6,d8,T8,p8,N6,S6,F6.data);else if(p.isCompressedArrayTexture)f.compressedTexSubImage3D(c8,S8,u8,q6,k6,d8,T8,p8,N6,F6.data);else f.texSubImage3D(c8,S8,u8,q6,k6,d8,T8,p8,N6,S6,F6);else if(k.isDataTexture)f.texSubImage2D(f.TEXTURE_2D,S8,u8,q6,d8,T8,N6,S6,F6.data);else if(k.isCompressedTexture)f.compressedTexSubImage2D(f.TEXTURE_2D,S8,u8,q6,F6.width,F6.height,N6,F6.data);else f.texSubImage2D(f.TEXTURE_2D,S8,u8,q6,d8,T8,N6,S6,F6);if(Q8.pixelStorei(f.UNPACK_ROW_LENGTH,h6),Q8.pixelStorei(f.UNPACK_IMAGE_HEIGHT,U6),Q8.pixelStorei(f.UNPACK_SKIP_PIXELS,m7),Q8.pixelStorei(f.UNPACK_SKIP_ROWS,j6),Q8.pixelStorei(f.UNPACK_SKIP_IMAGES,_0),S8===0&&p.generateMipmaps===!0&&p.mipmapsAutoUpdate===!0)f.generateMipmap(c8);Q8.unbindTexture()},this.initRenderTarget=function(k){if(f8.get(k).__webglFramebuffer===void 0)j8.setupRenderTarget(k)},this.initTexture=function(k){if(k.isCubeTexture)j8.setTextureCube(k,0);else if(k.isData3DTexture)j8.setTexture3D(k,0);else if(k.isDataArrayTexture||k.isCompressedArrayTexture)j8.setTexture2DArray(k,0);else j8.setTexture2D(k,0);Q8.unbindTexture()},this.resetState=function(){H8=0,e=0,S=null,Q8.reset(),C8.reset()},typeof __THREE_DEVTOOLS__<"u")__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return DJ}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(J){this._outputColorSpace=J;let Q=this.getContext();Q.drawingBufferColorSpace=K6._getDrawingBufferColorSpace(J),Q.unpackColorSpace=K6._getUnpackColorSpace()}}class tJ extends f9{constructor(){super();this.name="RoomEnvironment",this.position.y=-3.5;let J=new g7;J.deleteAttribute("uv");let Q=new x9({side:f6}),$=new x9,Z=new g9(16777215,900,28,2);Z.position.set(0.418,16.199,0.3),this.add(Z);let W=new M6(J,Q);W.position.set(-0.757,13.219,0.717),W.scale.set(31.713,28.305,28.591),this.add(W);let q=new E5(J,$,6),K=new z6;K.position.set(-10.906,2.009,1.846),K.rotation.set(0,-0.195,0),K.scale.set(2.328,7.905,4.651),K.updateMatrix(),q.setMatrixAt(0,K.matrix),K.position.set(-5.607,-0.754,-0.758),K.rotation.set(0,0.994,0),K.scale.set(1.97,1.534,3.955),K.updateMatrix(),q.setMatrixAt(1,K.matrix),K.position.set(6.167,0.857,7.803),K.rotation.set(0,0.561,0),K.scale.set(3.927,6.285,3.687),K.updateMatrix(),q.setMatrixAt(2,K.matrix),K.position.set(-2.017,0.018,6.124),K.rotation.set(0,0.333,0),K.scale.set(2.002,4.566,2.064),K.updateMatrix(),q.setMatrixAt(3,K.matrix),K.position.set(2.291,-0.756,-2.621),K.rotation.set(0,-0.286,0),K.scale.set(1.546,1.552,1.496),K.updateMatrix(),q.setMatrixAt(4,K.matrix),K.position.set(-2.193,-0.369,-5.547),K.rotation.set(0,0.516,0),K.scale.set(3.875,3.487,2.986),K.updateMatrix(),q.setMatrixAt(5,K.matrix),this.add(q);let H=new M6(J,l9(50));H.position.set(-16.116,14.37,8.208),H.scale.set(0.1,2.428,2.739),this.add(H);let U=new M6(J,l9(50));U.position.set(-16.109,18.021,-8.207),U.scale.set(0.1,2.425,2.751),this.add(U);let Y=new M6(J,l9(17));Y.position.set(14.904,12.198,-1.832),Y.scale.set(0.15,4.265,6.331),this.add(Y);let X=new M6(J,l9(43));X.position.set(-0.462,8.89,14.52),X.scale.set(4.38,5.441,0.088),this.add(X);let G=new M6(J,l9(20));G.position.set(3.235,11.486,-12.541),G.scale.set(2.5,2,0.1),this.add(G);let N=new M6(J,l9(100));N.position.set(0,20,0),N.scale.set(1,0.1,1),this.add(N)}dispose(){let J=new Set;this.traverse((Q)=>{if(Q.isMesh)J.add(Q.geometry),J.add(Q.material)});for(let Q of J)Q.dispose()}}function l9(J){return new A5({color:0,emissive:16777215,emissiveIntensity:J})}class B0{constructor(J){this.isFont=!0,this.type="Font",this.data=J}generateShapes(J,Q=100,$="ltr"){let Z=[],W=YX(J,Q,this.data,$);for(let q=0,K=W.length;q<K;q++)Z.push(...W[q].toShapes());return Z}}function YX(J,Q,$,Z){let W=Array.from(J),q=Q/$.resolution,K=($.boundingBox.yMax-$.boundingBox.yMin+$.underlineThickness)*q,H=[],U=0,Y=0;if(Z=="rtl"||Z=="tb")W.reverse();for(let X=0;X<W.length;X++){let G=W[X];if(G===`
`)U=0,Y-=K;else{let N=XX(G,q,U,Y,$);if(Z=="tb")U=0,Y+=$.ascender*q;else U+=N.offsetX;H.push(N.path)}}return H}function XX(J,Q,$,Z,W){let q=W.glyphs[J]||W.glyphs["?"];if(!q){console.error('THREE.Font: character "'+J+'" does not exists in font family '+W.familyName+".");return}let K=new i6,H,U,Y,X,G,N,F,M;if(q.o){let L=q._cachedOutline||(q._cachedOutline=q.o.split(" "));for(let E=0,O=L.length;E<O;)switch(L[E++]){case"m":H=L[E++]*Q+$,U=L[E++]*Q+Z,K.moveTo(H,U);break;case"l":H=L[E++]*Q+$,U=L[E++]*Q+Z,K.lineTo(H,U);break;case"q":Y=L[E++]*Q+$,X=L[E++]*Q+Z,G=L[E++]*Q+$,N=L[E++]*Q+Z,K.quadraticCurveTo(G,N,Y,X);break;case"b":Y=L[E++]*Q+$,X=L[E++]*Q+Z,G=L[E++]*Q+$,N=L[E++]*Q+Z,F=L[E++]*Q+$,M=L[E++]*Q+Z,K.bezierCurveTo(G,N,F,M,Y,X);break}}return{offsetX:q.ha*Q,path:K}}class h5 extends $9{constructor(J,Q={}){let $=Q.font;if($===void 0)super();else{let Z=$.generateShapes(J,Q.size,Q.direction);if(Q.depth===void 0)Q.depth=50;if(Q.bevelThickness===void 0)Q.bevelThickness=10;if(Q.bevelSize===void 0)Q.bevelSize=8;if(Q.bevelEnabled===void 0)Q.bevelEnabled=!1;super(Z,Q)}this.type="TextGeometry"}toJSON(){return super.toJSON()}static fromJSON(J){let Q=J.options;return Q.font=new B0(Q.font.data),new h5(Q.text,Q)}}var z0=v9;class V0 extends U9{constructor(J){super(J);this.defaultDPI=90,this.defaultUnit="px"}load(J,Q,$,Z){let W=this,q=new F0(W.manager);q.setPriority(W.priority),q.setCache(W.cache),q.setPath(W.path),q.setRequestHeader(W.requestHeader),q.setWithCredentials(W.withCredentials),q.load(J,function(K){try{Q(W.parse(K))}catch(H){if(Z)Z(H);else console.error(H);W.manager.itemError(J)}},$,Z)}parse(J){let Q=this;function $(d,P){if(d.nodeType!==1)return;if(d.hasAttribute("filter"))console.warn("THREE.SVGLoader: Filters are not supported.");let C=B(d),g=!1,K8=null;switch(d.nodeName){case"svg":P=M(d,P);break;case"style":W(d);break;case"g":P=M(d,P);break;case"path":if(P=M(d,P),d.hasAttribute("d"))K8=Z(d);break;case"rect":P=M(d,P),K8=H(d);break;case"polygon":P=M(d,P),K8=U(d);break;case"polyline":P=M(d,P),K8=Y(d);break;case"circle":P=M(d,P),K8=X(d);break;case"ellipse":P=M(d,P),K8=G(d);break;case"line":P=M(d,P),K8=N(d);break;case"defs":g=!0;break;case"use":P=M(d,P);let l=(d.getAttributeNS("http://www.w3.org/1999/xlink","href")||d.getAttribute("href")||"").substring(1),j=d.viewportElement.getElementById(l);if(j)$(j,P);else console.warn("SVGLoader: 'use node' references non-existent node id: "+l);break;default:}if(K8){if(P.fill!==void 0&&P.fill!=="none"&&!P.fill.startsWith("url"))K8.color.setStyle(P.fill,z0);D(K8,M8),T.push(K8);let A=Object.assign({},P);A.strokeWidth=P.strokeWidth*J8(M8),K8.userData={node:d,style:A,transform:M8.clone(),gradients:e}}let D8=d.childNodes;for(let A=0;A<D8.length;A++){let l=D8[A];if(g&&l.nodeName!=="style"&&l.nodeName!=="defs")continue;$(l,P)}if(C)if(S.pop(),S.length>0)M8.copy(S[S.length-1]);else M8.identity()}function Z(d){let P=new i6,C=new L8,g=new L8,K8=new L8,D8=!1,A=d.getAttribute("d");if(A===""||A==="none")return null;let l=A.match(/[a-df-z][^a-df-z]*/ig);for(let j=0,o=l.length;j<o;j++){let s=l[j],q8=s.charAt(0),N8=s.slice(1).trim();if(D8===!0){if(q8!=="M"&&q8!=="m"&&q8!=="Z"&&q8!=="z")P.moveTo(K8.x,K8.y);D8=!1}let h;switch(q8){case"M":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=2){if(C.x=h[x+0],C.y=h[x+1],g.x=C.x,g.y=C.y,x===0)P.moveTo(C.x,C.y);else P.lineTo(C.x,C.y);if(x===0)K8.copy(C)}break;case"H":h=E(N8);for(let x=0,k8=h.length;x<k8;x++)C.x=h[x],g.x=C.x,g.y=C.y,P.lineTo(C.x,C.y);break;case"V":h=E(N8);for(let x=0,k8=h.length;x<k8;x++)C.y=h[x],g.x=C.x,g.y=C.y,P.lineTo(C.x,C.y);break;case"L":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=2)C.x=h[x+0],C.y=h[x+1],g.x=C.x,g.y=C.y,P.lineTo(C.x,C.y);break;case"C":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=6)P.bezierCurveTo(h[x+0],h[x+1],h[x+2],h[x+3],h[x+4],h[x+5]),g.x=h[x+2],g.y=h[x+3],C.x=h[x+4],C.y=h[x+5];break;case"S":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=4)P.bezierCurveTo(L(C.x,g.x),L(C.y,g.y),h[x+0],h[x+1],h[x+2],h[x+3]),g.x=h[x+0],g.y=h[x+1],C.x=h[x+2],C.y=h[x+3];break;case"Q":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=4)P.quadraticCurveTo(h[x+0],h[x+1],h[x+2],h[x+3]),g.x=h[x+0],g.y=h[x+1],C.x=h[x+2],C.y=h[x+3];break;case"T":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=2){let f=L(C.x,g.x),Y8=L(C.y,g.y);P.quadraticCurveTo(f,Y8,h[x+0],h[x+1]),g.x=f,g.y=Y8,C.x=h[x+0],C.y=h[x+1]}break;case"A":h=E(N8,[3,4],7);for(let x=0,k8=h.length;x<k8;x+=7){if(h[x+5]==C.x&&h[x+6]==C.y)continue;let f=C.clone();C.x=h[x+5],C.y=h[x+6],g.x=C.x,g.y=C.y,q(P,h[x],h[x+1],h[x+2],h[x+3],h[x+4],f,C)}break;case"m":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=2){if(C.x+=h[x+0],C.y+=h[x+1],g.x=C.x,g.y=C.y,x===0)P.moveTo(C.x,C.y);else P.lineTo(C.x,C.y);if(x===0)K8.copy(C)}break;case"h":h=E(N8);for(let x=0,k8=h.length;x<k8;x++)C.x+=h[x],g.x=C.x,g.y=C.y,P.lineTo(C.x,C.y);break;case"v":h=E(N8);for(let x=0,k8=h.length;x<k8;x++)C.y+=h[x],g.x=C.x,g.y=C.y,P.lineTo(C.x,C.y);break;case"l":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=2)C.x+=h[x+0],C.y+=h[x+1],g.x=C.x,g.y=C.y,P.lineTo(C.x,C.y);break;case"c":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=6)P.bezierCurveTo(C.x+h[x+0],C.y+h[x+1],C.x+h[x+2],C.y+h[x+3],C.x+h[x+4],C.y+h[x+5]),g.x=C.x+h[x+2],g.y=C.y+h[x+3],C.x+=h[x+4],C.y+=h[x+5];break;case"s":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=4)P.bezierCurveTo(L(C.x,g.x),L(C.y,g.y),C.x+h[x+0],C.y+h[x+1],C.x+h[x+2],C.y+h[x+3]),g.x=C.x+h[x+0],g.y=C.y+h[x+1],C.x+=h[x+2],C.y+=h[x+3];break;case"q":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=4)P.quadraticCurveTo(C.x+h[x+0],C.y+h[x+1],C.x+h[x+2],C.y+h[x+3]),g.x=C.x+h[x+0],g.y=C.y+h[x+1],C.x+=h[x+2],C.y+=h[x+3];break;case"t":h=E(N8);for(let x=0,k8=h.length;x<k8;x+=2){let f=L(C.x,g.x),Y8=L(C.y,g.y);P.quadraticCurveTo(f,Y8,C.x+h[x+0],C.y+h[x+1]),g.x=f,g.y=Y8,C.x=C.x+h[x+0],C.y=C.y+h[x+1]}break;case"a":h=E(N8,[3,4],7);for(let x=0,k8=h.length;x<k8;x+=7){if(h[x+5]==0&&h[x+6]==0)continue;let f=C.clone();C.x+=h[x+5],C.y+=h[x+6],g.x=C.x,g.y=C.y,q(P,h[x],h[x+1],h[x+2],h[x+3],h[x+4],f,C)}break;case"Z":case"z":if(P.currentPath.autoClose=!0,P.currentPath.curves.length>0)C.copy(K8),P.currentPath.currentPoint.copy(C),D8=!0;break;default:console.warn(s)}}return P}function W(d){if(!d.sheet||!d.sheet.cssRules||!d.sheet.cssRules.length)return;for(let P=0;P<d.sheet.cssRules.length;P++){let C=d.sheet.cssRules[P];if(C.type!==1)continue;let g=C.selectorText.split(/,/gm).filter(Boolean).map((D8)=>D8.trim()),K8={};for(let D8=0;D8<C.style.length;D8++){let A=C.style[D8];K8[A]=C.style.getPropertyValue(A)}for(let D8=0;D8<g.length;D8++)H8[g[D8]]=Object.assign(H8[g[D8]]||{},K8)}}function q(d,P,C,g,K8,D8,A,l){if(P==0||C==0){d.lineTo(l.x,l.y);return}g=g*Math.PI/180,P=Math.abs(P),C=Math.abs(C);let j=(A.x-l.x)/2,o=(A.y-l.y)/2,s=Math.cos(g)*j+Math.sin(g)*o,q8=-Math.sin(g)*j+Math.cos(g)*o,N8=P*P,h=C*C,x=s*s,k8=q8*q8,f=x/N8+k8/h;if(f>1){let R=Math.sqrt(f);P=R*P,C=R*C,N8=P*P,h=C*C}let Y8=N8*k8+h*x,Z8=(N8*h-Y8)/Y8,A8=Math.sqrt(Math.max(0,Z8));if(K8===D8)A8=-A8;let Q8=A8*P*q8/C,m8=-A8*C*s/P,f8=Math.cos(g)*Q8-Math.sin(g)*m8+(A.x+l.x)/2,j8=Math.sin(g)*Q8+Math.cos(g)*m8+(A.y+l.y)/2,l8=K(1,0,(s-Q8)/P,(q8-m8)/C),I=K((s-Q8)/P,(q8-m8)/C,(-s-Q8)/P,(-q8-m8)/C)%(Math.PI*2);d.currentPath.absellipse(f8,j8,P,C,l8,l8+I,D8===0,g)}function K(d,P,C,g){let K8=d*C+P*g,D8=Math.sqrt(d*d+P*P)*Math.sqrt(C*C+g*g),A=Math.acos(Math.max(-1,Math.min(1,K8/D8)));if(d*g-P*C<0)A=-A;return A}function H(d){let P=V(d.getAttribute("x")||0),C=V(d.getAttribute("y")||0),g=V(d.getAttribute("rx")||d.getAttribute("ry")||0),K8=V(d.getAttribute("ry")||d.getAttribute("rx")||0),D8=V(d.getAttribute("width")),A=V(d.getAttribute("height")),l=0.448084975506,j=new i6;if(j.moveTo(P+g,C),j.lineTo(P+D8-g,C),g!==0||K8!==0)j.bezierCurveTo(P+D8-g*0.448084975506,C,P+D8,C+K8*0.448084975506,P+D8,C+K8);if(j.lineTo(P+D8,C+A-K8),g!==0||K8!==0)j.bezierCurveTo(P+D8,C+A-K8*0.448084975506,P+D8-g*0.448084975506,C+A,P+D8-g,C+A);if(j.lineTo(P+g,C+A),g!==0||K8!==0)j.bezierCurveTo(P+g*0.448084975506,C+A,P,C+A-K8*0.448084975506,P,C+A-K8);if(j.lineTo(P,C+K8),g!==0||K8!==0)j.bezierCurveTo(P,C+K8*0.448084975506,P+g*0.448084975506,C,P+g,C);return j}function U(d){function P(D8,A,l){let j=V(A),o=V(l);if(K8===0)g.moveTo(j,o);else g.lineTo(j,o);K8++}let C=/([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?:,|\s)([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)/g,g=new i6,K8=0;return d.getAttribute("points").replace(C,P),g.currentPath.autoClose=!0,g}function Y(d){function P(D8,A,l){let j=V(A),o=V(l);if(K8===0)g.moveTo(j,o);else g.lineTo(j,o);K8++}let C=/([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)(?:,|\s)([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)/g,g=new i6,K8=0;return d.getAttribute("points").replace(C,P),g.currentPath.autoClose=!1,g}function X(d){let P=V(d.getAttribute("cx")||0),C=V(d.getAttribute("cy")||0),g=V(d.getAttribute("r")||0),K8=new V7;K8.absarc(P,C,g,0,Math.PI*2);let D8=new i6;return D8.subPaths.push(K8),D8}function G(d){let P=V(d.getAttribute("cx")||0),C=V(d.getAttribute("cy")||0),g=V(d.getAttribute("rx")||0),K8=V(d.getAttribute("ry")||0),D8=new V7;D8.absellipse(P,C,g,K8,0,Math.PI*2);let A=new i6;return A.subPaths.push(D8),A}function N(d){let P=V(d.getAttribute("x1")||0),C=V(d.getAttribute("y1")||0),g=V(d.getAttribute("x2")||0),K8=V(d.getAttribute("y2")||0),D8=new i6;return D8.moveTo(P,C),D8.lineTo(g,K8),D8.currentPath.autoClose=!1,D8}function F(d){let C=d.querySelectorAll("linearGradient, radialGradient"),g=["x1","y1","x2","y2","cx","cy","r","fx","fy","gradientUnits","gradientTransform","spreadMethod"],K8={};for(let A of C){let l=A.getAttribute("id");if(!l)continue;let j={type:A.nodeName==="radialGradient"?"radialGradient":"linearGradient",attrs:{},stops:null,href:null},o=A.getAttributeNS("http://www.w3.org/1999/xlink","href")||A.getAttribute("href")||"";if(o.startsWith("#"))j.href=o.substring(1);for(let q8 of g)if(A.hasAttribute(q8))j.attrs[q8]=A.getAttribute(q8);let s=A.querySelectorAll("stop");if(s.length>0){j.stops=[];for(let q8 of s){let N8=q8.getAttribute("stop-color");if(!N8&&q8.style)N8=q8.style["stop-color"];if(!N8)N8="#000";let h=q8.getAttribute("stop-opacity");if((h===null||h==="")&&q8.style)h=q8.style["stop-opacity"];h=h===null||h===""||h===void 0?1:Math.max(0,Math.min(1,parseFloat(h)));let x=Math.max(0,Math.min(1,parseFloat(q8.getAttribute("offset")||"0")));j.stops.push({offset:x,color:N8,opacity:h})}}K8[l]=j}function D8(A,l){let j=K8[A];if(!j||l.has(A))return j;if(l.add(A),j.href&&K8[j.href]){let o=D8(j.href,l);if(o){if(!j.stops)j.stops=o.stops;for(let s in o.attrs)if(!(s in j.attrs))j.attrs[s]=o.attrs[s]}}return j}for(let A in K8)D8(A,new Set);for(let A in K8){let q8=function(N8){if(typeof N8!=="string")return 0;if(N8.endsWith("%"))return parseFloat(N8)/100;return V(N8)},l=K8[A],j=l.attrs,o=j.gradientUnits==="userSpaceOnUse"?"userSpaceOnUse":"objectBoundingBox",s={type:l.type,gradientUnits:o,spreadMethod:j.spreadMethod==="reflect"||j.spreadMethod==="repeat"?j.spreadMethod:"pad",gradientTransform:null,stops:(l.stops||[]).slice().sort((N8,h)=>N8.offset-h.offset)};if(j.gradientTransform)s.gradientTransform=new i8,y(j.gradientTransform,s.gradientTransform);if(l.type==="linearGradient")s.x1=j.x1!==void 0?q8(j.x1):0,s.y1=j.y1!==void 0?q8(j.y1):0,s.x2=j.x2!==void 0?q8(j.x2):o==="objectBoundingBox"?1:0,s.y2=j.y2!==void 0?q8(j.y2):0;else{let N8=o==="objectBoundingBox"?0.5:0,h=o==="objectBoundingBox"?0.5:0;s.cx=j.cx!==void 0?q8(j.cx):N8,s.cy=j.cy!==void 0?q8(j.cy):N8,s.r=j.r!==void 0?q8(j.r):h,s.fx=j.fx!==void 0?q8(j.fx):s.cx,s.fy=j.fy!==void 0?q8(j.fy):s.cy}e[A]=s}}function M(d,P){P=Object.assign({},P);let C={};if(d.hasAttribute("class")){let A=d.getAttribute("class").split(/\s/).filter(Boolean).map((l)=>l.trim());for(let l=0;l<A.length;l++)C=Object.assign(C,H8["."+A[l]])}if(d.hasAttribute("id"))C=Object.assign(C,H8["#"+d.getAttribute("id")]);function g(A,l,j){if(j===void 0)j=function(s){return s};if(d.hasAttribute(A))P[l]=j(d.getAttribute(A));if(C[A])P[l]=j(C[A]);if(d.style&&d.style[A]!=="")P[l]=j(d.style[A])}function K8(A){return Math.max(0,Math.min(1,V(A)))}function D8(A){return Math.max(0,V(A))}return g("fill","fill"),g("fill-opacity","fillOpacity",K8),g("fill-rule","fillRule"),g("opacity","opacity",K8),g("stroke","stroke"),g("stroke-opacity","strokeOpacity",K8),g("stroke-width","strokeWidth",D8),g("stroke-linejoin","strokeLineJoin"),g("stroke-linecap","strokeLineCap"),g("stroke-miterlimit","strokeMiterLimit",D8),g("visibility","visibility"),P}function L(d,P){return d-(P-d)}function E(d,P,C){if(typeof d!=="string")throw TypeError("Invalid input: "+typeof d);let g={SEPARATOR:/[ \t\r\n\,.\-+]/,WHITESPACE:/[ \t\r\n]/,DIGIT:/[\d]/,SIGN:/[-+]/,POINT:/\./,COMMA:/,/,EXP:/e/i,FLAGS:/[01]/},K8=0,D8=1,A=2,l=3,j=K8,o=!0,s="",q8="",N8=[];function h(Y8,Z8,A8){let Q8=SyntaxError('Unexpected character "'+Y8+'" at index '+Z8+".");throw Q8.partial=A8,Q8}function x(){if(s!=="")if(q8==="")N8.push(Number(s));else N8.push(Number(s)*Math.pow(10,Number(q8)));s="",q8=""}let k8,f=d.length;for(let Y8=0;Y8<f;Y8++){if(k8=d[Y8],Array.isArray(P)&&P.includes(N8.length%C)&&g.FLAGS.test(k8)){j=D8,s=k8,x();continue}if(j===K8){if(g.WHITESPACE.test(k8))continue;if(g.DIGIT.test(k8)||g.SIGN.test(k8)){j=D8,s=k8;continue}if(g.POINT.test(k8)){j=A,s=k8;continue}if(g.COMMA.test(k8)){if(o)h(k8,Y8,N8);o=!0}}if(j===D8){if(g.DIGIT.test(k8)){s+=k8;continue}if(g.POINT.test(k8)){s+=k8,j=A;continue}if(g.EXP.test(k8)){j=l;continue}if(g.SIGN.test(k8)&&s.length===1&&g.SIGN.test(s[0]))h(k8,Y8,N8)}if(j===A){if(g.DIGIT.test(k8)){s+=k8;continue}if(g.EXP.test(k8)){j=l;continue}if(g.POINT.test(k8)&&s[s.length-1]===".")h(k8,Y8,N8)}if(j===l){if(g.DIGIT.test(k8)){q8+=k8;continue}if(g.SIGN.test(k8)){if(q8===""){q8+=k8;continue}if(q8.length===1&&g.SIGN.test(q8))h(k8,Y8,N8)}}if(g.WHITESPACE.test(k8))x(),j=K8,o=!1;else if(g.COMMA.test(k8))x(),j=K8,o=!0;else if(g.SIGN.test(k8))x(),j=D8,s=k8;else if(g.POINT.test(k8))x(),j=A,s=k8;else h(k8,Y8,N8)}return x(),N8}let O=["mm","cm","in","pt","pc","px"],_={mm:{mm:1,cm:0.1,in:0.03937007874015748,pt:2.834645669291339,pc:0.2362204724409449,px:-1},cm:{mm:10,cm:1,in:0.39370078740157477,pt:28.346456692913385,pc:2.3622047244094486,px:-1},in:{mm:25.4,cm:2.54,in:1,pt:72,pc:6,px:-1},pt:{mm:0.35277777777777775,cm:0.035277777777777776,in:0.013888888888888888,pt:1,pc:0.08333333333333333,px:-1},pc:{mm:4.233333333333333,cm:0.42333333333333334,in:0.16666666666666666,pt:12,pc:1,px:-1},px:{px:1}};function V(d){let P="px";if(typeof d==="string"||d instanceof String)for(let g=0,K8=O.length;g<K8;g++){let D8=O[g];if(d.endsWith(D8)){P=D8,d=d.substring(0,d.length-D8.length);break}}let C=void 0;if(P==="px"&&Q.defaultUnit!=="px")C=_.in[Q.defaultUnit]/Q.defaultDPI;else if(C=_[P][Q.defaultUnit],C<0)C=_[P].in*Q.defaultDPI;return C*parseFloat(d)}function B(d){if(!(d.hasAttribute("transform")||d.nodeName==="use"&&(d.hasAttribute("x")||d.hasAttribute("y"))))return null;let P=w(d);if(S.length>0)P.premultiply(S[S.length-1]);return M8.copy(P),S.push(P),P}function w(d){let P=new i8;if(d.nodeName==="use"&&(d.hasAttribute("x")||d.hasAttribute("y"))){let C=V(d.getAttribute("x")||0),g=V(d.getAttribute("y")||0);P.makeTranslation(C,g)}if(d.hasAttribute("transform"))y(d.getAttribute("transform"),P);return P}function y(d,P){let C=B8,g=d.split(")");for(let K8=g.length-1;K8>=0;K8--){let D8=g[K8].trim();if(D8==="")continue;let A=D8.indexOf("("),l=D8.length;if(A>0&&A<l){let j=D8.slice(0,A),o=E(D8.slice(A+1));switch(C.identity(),j){case"translate":if(o.length>=1){let s=o[0],q8=0;if(o.length>=2)q8=o[1];C.makeTranslation(s,q8)}break;case"rotate":if(o.length>=1){let s=0,q8=0,N8=0;if(s=o[0]*Math.PI/180,o.length>=3)q8=o[1],N8=o[2];i.makeTranslation(-q8,-N8),X8.makeRotation(s),V8.multiplyMatrices(X8,i),i.makeTranslation(q8,N8),C.multiplyMatrices(i,V8)}break;case"scale":if(o.length>=1){let s=o[0],q8=s;if(o.length>=2)q8=o[1];C.makeScale(s,q8)}break;case"skewX":if(o.length===1)C.set(1,Math.tan(o[0]*Math.PI/180),0,0,1,0,0,0,1);break;case"skewY":if(o.length===1)C.set(1,0,0,Math.tan(o[0]*Math.PI/180),1,0,0,0,1);break;case"matrix":if(o.length===6)C.set(o[0],o[2],o[4],o[1],o[3],o[5],0,0,1);break}P.premultiply(C)}}return P}function D(d,P){function C(A){U8.set(A.x,A.y,1).applyMatrix3(P),A.set(U8.x,U8.y)}function g(A){let{xRadius:l,yRadius:j}=A,o=Math.cos(A.aRotation),s=Math.sin(A.aRotation),q8=new u(l*o,l*s,0),N8=new u(-j*s,j*o,0),h=q8.applyMatrix3(P),x=N8.applyMatrix3(P),k8=B8.set(h.x,x.x,0,h.y,x.y,0,0,0,1),f=i.copy(k8).invert(),A8=X8.copy(f).transpose().multiply(f).elements,Q8=E8(A8[0],A8[1],A8[4]),m8=Math.sqrt(Q8.rt1),f8=Math.sqrt(Q8.rt2);if(A.xRadius=1/m8,A.yRadius=1/f8,A.aRotation=Math.atan2(Q8.sn,Q8.cs),!((A.aEndAngle-A.aStartAngle)%(2*Math.PI)<Number.EPSILON)){let l8=i.set(m8,0,0,0,f8,0,0,0,1),I=X8.set(Q8.cs,Q8.sn,0,-Q8.sn,Q8.cs,0,0,0,1),R=l8.multiply(I).multiply(k8),c=(z8)=>{let{x:R8,y:I8}=new u(Math.cos(z8),Math.sin(z8),0).applyMatrix3(R);return Math.atan2(I8,R8)};if(A.aStartAngle=c(A.aStartAngle),A.aEndAngle=c(A.aEndAngle),z(P))A.aClockwise=!A.aClockwise}}function K8(A){let l=t(P),j=v(P);A.xRadius*=l,A.yRadius*=j;let o=l>Number.EPSILON?Math.atan2(P.elements[1],P.elements[0]):Math.atan2(-P.elements[3],P.elements[4]);if(A.aRotation+=o,z(P))A.aStartAngle*=-1,A.aEndAngle*=-1,A.aClockwise=!A.aClockwise}let D8=d.subPaths;for(let A=0,l=D8.length;A<l;A++){let o=D8[A].curves;for(let s=0;s<o.length;s++){let q8=o[s];if(q8.isLineCurve)C(q8.v1),C(q8.v2);else if(q8.isCubicBezierCurve)C(q8.v0),C(q8.v1),C(q8.v2),C(q8.v3);else if(q8.isQuadraticBezierCurve)C(q8.v0),C(q8.v1),C(q8.v2);else if(q8.isEllipseCurve)if(v8.set(q8.aX,q8.aY),C(v8),q8.aX=v8.x,q8.aY=v8.y,m(P))g(q8);else K8(q8)}}}function z(d){let P=d.elements;return P[0]*P[4]-P[1]*P[3]<0}function m(d){let P=d.elements,C=P[0]*P[3]+P[1]*P[4];if(C===0)return!1;let g=t(d),K8=v(d);return Math.abs(C/(g*K8))>Number.EPSILON}function t(d){let P=d.elements;return Math.sqrt(P[0]*P[0]+P[1]*P[1])}function v(d){let P=d.elements;return Math.sqrt(P[3]*P[3]+P[4]*P[4])}function J8(d){let P=d.elements,C=P[0]*P[4]-P[1]*P[3];return Math.sqrt(Math.abs(C))}function E8(d,P,C){let g,K8,D8,A,l,j=d+C,o=d-C,s=Math.sqrt(o*o+4*P*P);if(j>0)g=0.5*(j+s),l=1/g,K8=d*l*C-P*l*P;else if(j<0)K8=0.5*(j-s);else g=0.5*s,K8=-0.5*s;if(o>0)D8=o+s;else D8=o-s;if(Math.abs(D8)>2*Math.abs(P))l=-2*P/D8,A=1/Math.sqrt(1+l*l),D8=l*A;else if(Math.abs(P)===0)D8=1,A=0;else l=-0.5*D8/P,D8=1/Math.sqrt(1+l*l),A=l*D8;if(o>0)l=D8,D8=-A,A=l;return{rt1:g,rt2:K8,cs:D8,sn:A}}let T=[],H8={},e={},S=[],B8=new i8,i=new i8,X8=new i8,V8=new i8,v8=new L8,U8=new u,M8=new i8,b8=new DOMParser().parseFromString(J,"image/svg+xml");return F(b8),$(b8.documentElement,{fill:"#000",fillOpacity:1,strokeOpacity:1,strokeWidth:1,strokeLineJoin:"miter",strokeLineCap:"butt",strokeMiterLimit:4}),{paths:T,gradients:e,xml:b8.documentElement}}static createFillMaterial(J){let Q=J.userData.style;if(Q.fill===void 0||Q.fill==="none")return null;let $=J.color,Z=null,W=dZ.exec(Q.fill);if(W){let K=J.userData.gradients&&J.userData.gradients[W[1]];Z=GX(K,J)}let q=new b9({opacity:Q.fillOpacity*(Q.opacity||1),transparent:!0,side:m6,depthWrite:!1});if(Z!==null)q.map=Z;else q.color=$;return q}static createStrokeMaterial(J){let Q=J.userData.style;if(Q.stroke===void 0||Q.stroke==="none")return null;if(dZ.test(Q.stroke))console.warn("THREE.SVGLoader: Gradient strokes are not supported.");return new b9({color:new r8().setStyle(Q.stroke,z0),opacity:Q.strokeOpacity*(Q.opacity||1),transparent:!0,side:m6,depthWrite:!1})}static createShapes(J){return console.warn("SVGLoader: createShapes() is deprecated. Use shapePath.toShapes() instead."),J.toShapes()}static getStrokeStyle(J,Q,$,Z,W){return J=J!==void 0?J:1,Q=Q!==void 0?Q:"#000",$=$!==void 0?$:"miter",Z=Z!==void 0?Z:"butt",W=W!==void 0?W:4,{strokeColor:Q,strokeWidth:J,strokeLineJoin:$,strokeLineCap:Z,strokeMiterLimit:W}}static pointsToStroke(J,Q,$,Z){let W=[],q=[],K=[];if(V0.pointsToStrokeWithBuffers(J,Q,$,Z,W,q,K)===0)return null;let H=new $7;return H.setAttribute("position",new T6(W,3)),H.setAttribute("normal",new T6(q,3)),H.setAttribute("uv",new T6(K,2)),H}static pointsToStrokeWithBuffers(J,Q,$,Z,W,q,K,H){let U=new L8,Y=new L8,X=new L8,G=new L8,N=new L8,F=new L8,M=new L8,L=new L8,E=new L8,O=new L8,_=new L8,V=new L8,B=new L8,w=new L8,y=new L8,D=new L8,z=new L8;$=$!==void 0?$:12,Z=Z!==void 0?Z:0.001,H=H!==void 0?H:0,J=D8(J);let m=J.length;if(m<2)return 0;let t=J[0].equals(J[m-1]),v,J8=J[0],E8,T=Q.strokeWidth/2,H8=1/(m-1),e=0,S,B8,i,X8,V8=!1,v8=0,U8=H*3,M8=H*2;b8(J[0],J[1],U).multiplyScalar(T),L.copy(J[0]).sub(U),E.copy(J[0]).add(U),O.copy(L),_.copy(E);for(let A=1;A<m;A++){if(v=J[A],A===m-1)if(t)E8=J[1];else E8=void 0;else E8=J[A+1];let l=U;if(b8(J8,v,l),X.copy(l).multiplyScalar(T),V.copy(v).sub(X),B.copy(v).add(X),S=e+H8,B8=!1,E8!==void 0){if(b8(v,E8,Y),X.copy(Y).multiplyScalar(T),w.copy(v).sub(X),y.copy(v).add(X),i=!0,X.subVectors(E8,J8),l.dot(X)<0)i=!1;if(A===1)V8=i;X.subVectors(E8,v),X.normalize();let j=Math.abs(l.dot(X));if(j>Number.EPSILON){let o=T/j;X.multiplyScalar(-o),G.subVectors(v,J8),N.copy(G).setLength(o).add(X),D.copy(N).negate();let s=N.length(),q8=G.length();G.divideScalar(q8),F.subVectors(E8,v);let N8=F.length();if(F.divideScalar(N8),G.dot(D)<q8&&F.dot(D)<N8)B8=!0;if(z.copy(N).add(v),D.add(v),B8){let h=i?E:L,x=(z.x-h.x)*(D.y-h.y)-(z.y-h.y)*(D.x-h.x);if(i&&x<0||!i&&x>0)D.copy(h)}if(X8=!1,B8)if(i)y.copy(D),B.copy(D);else w.copy(D),V.copy(D);else P();switch(Q.strokeLineJoin){case"bevel":C(i,B8,S);break;case"round":if(g(i,B8),i)d(v,V,w,S,0);else d(v,y,B,S,1);break;case"miter":case"miter-clip":default:let h=T*Q.strokeMiterLimit/s;if(h<1)if(Q.strokeLineJoin!=="miter-clip"){C(i,B8,S);break}else if(g(i,B8),i)F.subVectors(z,V).multiplyScalar(h).add(V),M.subVectors(z,w).multiplyScalar(h).add(w),n(V,S,0),n(F,S,0),n(v,S,0.5),n(v,S,0.5),n(F,S,0),n(M,S,0),n(v,S,0.5),n(M,S,0),n(w,S,0);else F.subVectors(z,B).multiplyScalar(h).add(B),M.subVectors(z,y).multiplyScalar(h).add(y),n(B,S,1),n(F,S,1),n(v,S,0.5),n(v,S,0.5),n(F,S,1),n(M,S,1),n(v,S,0.5),n(M,S,1),n(y,S,1);else{if(B8){if(i)n(E,e,1),n(L,e,0),n(z,S,0),n(E,e,1),n(z,S,0),n(D,S,1);else n(E,e,1),n(L,e,0),n(z,S,1),n(L,e,0),n(D,S,0),n(z,S,1);if(i)w.copy(z);else y.copy(z)}else if(i)n(V,S,0),n(z,S,0),n(v,S,0.5),n(v,S,0.5),n(z,S,0),n(w,S,0);else n(B,S,1),n(z,S,1),n(v,S,0.5),n(v,S,0.5),n(z,S,1),n(y,S,1);X8=!0}break}}else P()}else P();if(!t&&A===m-1)K8(J[0],O,_,i,!0,e);e=S,J8=v,L.copy(w),E.copy(y)}if(!t)K8(v,V,B,i,!1,S);else if(B8&&W){let A=z,l=D;if(V8!==i)A=D,l=z;if(i){if(X8||V8){if(l.toArray(W,0),l.toArray(W,9),X8)A.toArray(W,3)}}else if(X8||!V8){if(l.toArray(W,3),l.toArray(W,9),X8)A.toArray(W,0)}}if(W){let A=[new L8,new L8,new L8],l=H*3;for(let j=l;j<U8;j+=9)if(A[0].set(W[j],W[j+1]),A[1].set(W[j+3],W[j+4]),A[2].set(W[j+6],W[j+7]),H7.area(A)<0)W[j+3]=A[0].x,W[j+4]=A[0].y}return v8;function b8(A,l,j){return j.subVectors(l,A),j.set(-j.y,j.x).normalize()}function n(A,l,j){if(W){if(W[U8]=A.x,W[U8+1]=A.y,W[U8+2]=0,q)q[U8]=0,q[U8+1]=0,q[U8+2]=1;if(U8+=3,K)K[M8]=l,K[M8+1]=j,M8+=2}v8+=3}function d(A,l,j,o,s){U.copy(l).sub(A).normalize(),Y.copy(j).sub(A).normalize();let q8=Math.PI,N8=U.dot(Y);if(Math.abs(N8)<1)q8=Math.abs(Math.acos(N8));q8/=$,X.copy(l);for(let h=0,x=$-1;h<x;h++)G.copy(X).rotateAround(A,q8),n(X,o,s),n(G,o,s),n(A,o,0.5),X.copy(G);n(X,o,s),n(j,o,s),n(A,o,0.5)}function P(){n(E,e,1),n(L,e,0),n(V,S,0),n(E,e,1),n(V,S,0),n(B,S,1)}function C(A,l,j){if(l)if(A)n(E,e,1),n(L,e,0),n(V,S,0),n(E,e,1),n(V,S,0),n(D,S,1),n(V,j,0),n(w,j,0),n(D,j,0.5);else n(E,e,1),n(L,e,0),n(B,S,1),n(L,e,0),n(D,S,0),n(B,S,1),n(B,j,1),n(D,j,0),n(y,j,1);else if(A)n(V,j,0),n(w,j,0),n(v,j,0.5);else n(B,j,1),n(y,j,0),n(v,j,0.5)}function g(A,l){if(l)if(A)n(E,e,1),n(L,e,0),n(V,S,0),n(E,e,1),n(V,S,0),n(D,S,1),n(V,e,0),n(v,S,0.5),n(D,S,1),n(v,S,0.5),n(w,e,0),n(D,S,1);else n(E,e,1),n(L,e,0),n(B,S,1),n(L,e,0),n(D,S,0),n(B,S,1),n(B,e,1),n(D,S,0),n(v,S,0.5),n(v,S,0.5),n(D,S,0),n(y,e,1)}function K8(A,l,j,o,s,q8){switch(Q.strokeLineCap){case"round":if(s)d(A,j,l,q8,0.5);else d(A,l,j,q8,0.5);break;case"square":if(s)if(U.subVectors(l,A),Y.set(U.y,-U.x),X.addVectors(U,Y).add(A),G.subVectors(Y,U).add(A),o)X.toArray(W,3),G.toArray(W,0),G.toArray(W,9);else X.toArray(W,3),K[7]===1?G.toArray(W,9):X.toArray(W,9),G.toArray(W,0);else{U.subVectors(j,A),Y.set(U.y,-U.x),X.addVectors(U,Y).add(A),G.subVectors(Y,U).add(A);let N8=W.length;if(o)X.toArray(W,N8-3),G.toArray(W,N8-6),G.toArray(W,N8-12);else G.toArray(W,N8-6),X.toArray(W,N8-3),G.toArray(W,N8-12)}break;case"butt":default:break}}function D8(A){let l=!1;for(let o=1,s=A.length-1;o<s;o++)if(A[o].distanceTo(A[o+1])<Z){l=!0;break}if(!l)return A;let j=[];j.push(A[0]);for(let o=1,s=A.length-1;o<s;o++)if(A[o].distanceTo(A[o+1])>=Z)j.push(A[o]);return j.push(A[A.length-1]),j}}}var dZ=/^\s*url\(\s*(?:["']\s*)?#([^)'"\s]+)(?:\s*["'])?\s*\)\s*$/;function GX(J,Q,$=256){if(!J||!Array.isArray(J.stops)||J.stops.length===0)return null;let Z=Q.userData.transform,W=J.gradientUnits==="objectBoundingBox",q=null;if(W){if(q=NX(Q,Z),q===null)return null}function K(G,N,F){if(F.set(G,N,1),J.gradientTransform)F.applyMatrix3(J.gradientTransform);if(W)F.set(q.minX+F.x*q.width,q.minY+F.y*q.height,1);if(Z)F.applyMatrix3(Z)}let H=document.createElement("canvas"),U;if(J.type==="linearGradient"){H.width=$,H.height=1;let G=H.getContext("2d"),N=G.createLinearGradient(0,0,$,0);uZ(N,J.stops),G.fillStyle=N,G.fillRect(0,0,$,1);let F=new u,M=new u;K(J.x1,J.y1,F),K(J.x2,J.y2,M);let L=M.x-F.x,E=M.y-F.y,O=L*L+E*E||0.00000000000000000001,_=L/O,V=E/O,B=-(_*F.x+V*F.y);U=new i8().set(_,V,B,0,0,0.5,0,0,1)}else{let{cx:G,cy:N,fx:F,fy:M,r:L}=J;if(J.gradientTransform){let z=new u;z.set(G,N,1).applyMatrix3(J.gradientTransform),G=z.x,N=z.y,z.set(F,M,1).applyMatrix3(J.gradientTransform),F=z.x,M=z.y}if(W)G=q.minX+G*q.width,N=q.minY+N*q.height,F=q.minX+F*q.width,M=q.minY+M*q.height,L=L*Math.sqrt((q.width*q.width+q.height*q.height)/2);if(L<=0)return null;H.width=$,H.height=$;let E=H.getContext("2d"),O=G-L,_=N-L,V=2*L,B=$/V;E.setTransform(B,0,0,B,-O*B,-_*B);let w=E.createRadialGradient(F,M,0,G,N,L);uZ(w,J.stops),E.fillStyle=w,E.fillRect(O,_,V,V);let y=Z?Z.clone().invert():new i8;U=new i8().set(1/V,0,-O/V,0,1/V,-_/V,0,0,1).multiply(y)}let Y=new O5(H);Y.colorSpace=z0,Y.flipY=!1,Y.matrixAutoUpdate=!1,Y.matrix=U;let X=J.spreadMethod==="reflect"?J5:J.spreadMethod==="repeat"?e0:j9;return Y.wrapS=X,Y.wrapT=X,Y}function NX(J,Q){let $=Q?Q.clone().invert():null,Z=new L8,W=new O0;for(let q of J.subPaths)for(let K of q.getPoints()){if(Z.copy(K),$)Z.applyMatrix3($);W.expandByPoint(Z)}if(W.isEmpty())return null;return{minX:W.min.x,minY:W.min.y,width:W.max.x-W.min.x,height:W.max.y-W.min.y}}function uZ(J,Q){let $=new r8;for(let Z of Q){let W=Z.color;if(Z.opacity<1){$.setStyle(Z.color,z0);let q=/rgb\(([^)]+)\)/.exec($.getStyle(z0));if(q)W=`rgba(${q[1]},${Z.opacity})`}J.addColorStop(Math.max(0,Math.min(1,Z.offset)),W)}}var cZ="M174.672 0C220.358 1.5066 264.391 6.78969 296.438 34.4639C328.591 61.044 348.736 110.001 349.322 173.379C348.736 236.738 328.591 285.715 296.438 312.298C264.391 339.972 220.379 345.255 174.672 346.759C128.964 345.255 84.9495 339.972 52.9032 312.298C20.7523 285.715 0.588472 236.768 0 173.39C0.585675 109.973 20.7523 61.0216 52.9032 34.4639C84.9495 6.78971 128.964 1.5066 174.672 0ZM174.667 76.4142C149.135 77.2561 124.549 80.2083 106.648 95.6723C88.6886 110.512 77.4237 137.866 77.1085 173.291C77.4252 208.717 88.6886 236.068 106.648 250.923C124.549 266.387 149.135 269.339 174.667 270.179C200.199 269.339 224.784 266.387 242.685 250.923C260.646 236.068 271.898 208.7 272.226 173.297C271.898 137.882 260.646 110.525 242.685 95.6723C224.784 80.2083 200.187 77.2561 174.667 76.4142Z";var nZ={glyphs:{"0":{ha:910,x_min:47,x_max:863,o:"m 455 -14 l 455 -14 q 235 48 326 -14 q 95 225 144 109 q 47 505 47 340 l 47 505 q 96 784 47 668 q 236 962 144 901 q 455 1024 327 1024 l 455 1024 q 675 962 584 1024 q 815 785 766 901 q 863 505 863 669 l 863 505 q 815 225 863 340 q 676 48 767 109 q 455 -14 585 -14 z m 455 163 l 455 163 q 559 202 517 163 q 624 319 602 242 q 646 505 646 395 l 646 505 q 624 691 646 614 q 559 808 602 768 q 455 848 517 848 l 455 848 q 314 759 363 848 q 264 505 264 669 l 264 505 q 287 319 264 395 q 351 202 309 242 q 455 163 394 163 z "},"1":{ha:555,x_min:40,x_max:490,o:"m 290 1010 l 490 1010 l 490 0 l 277 0 l 277 808 l 271 808 l 40 662 l 40 852 l 290 1010 z "},"2":{ha:829,x_min:49,x_max:779,o:"m 779 0 l 59 0 l 59 153 l 418 487 q 496 567 465 531 q 543 636 527 602 q 559 711 559 671 l 559 711 q 539 787 559 755 q 484 837 519 819 q 405 854 450 854 l 405 854 q 324 836 359 854 q 271 782 290 817 q 252 699 252 747 l 252 699 l 49 699 q 94 871 49 798 q 220 984 139 944 q 407 1024 301 1024 l 407 1024 q 595 986 515 1024 q 721 880 676 947 q 766 724 766 812 l 766 724 q 743 612 766 667 q 664 489 721 557 q 503 326 607 420 l 503 326 l 355 182 l 355 174 l 779 174 l 779 0 z "},"3":{ha:871,x_min:50,x_max:821,o:"m 433 -14 l 433 -14 q 236 24 321 -14 q 100 130 150 62 q 50 286 51 197 l 50 286 l 264 286 q 288 221 266 249 q 348 178 311 193 q 433 163 386 163 l 433 163 q 519 180 481 163 q 578 227 557 197 q 599 298 599 258 l 599 298 q 576 370 599 339 q 513 418 554 401 q 414 436 471 436 l 414 436 l 319 436 l 319 593 l 414 593 q 499 610 463 593 q 557 657 536 627 q 578 726 578 687 l 578 726 q 560 793 578 765 q 510 838 542 822 q 435 854 478 854 l 435 854 q 355 839 391 854 q 297 795 319 823 q 275 728 275 767 l 275 728 l 69 728 q 119 882 71 816 q 249 986 167 949 q 435 1024 332 1024 l 435 1024 q 619 986 541 1024 q 741 884 697 948 q 784 739 784 819 l 784 739 q 731 598 784 654 q 593 526 678 541 l 593 526 l 593 518 q 763 441 705 504 q 821 283 821 378 l 821 283 q 771 130 821 197 q 633 25 721 63 q 433 -14 546 -14 z "},"4":{ha:896,x_min:44,x_max:859,o:"m 859 178 l 44 178 l 44 345 l 465 1010 l 610 1010 l 610 777 l 524 777 l 258 357 l 258 349 l 859 349 l 859 178 z m 733 0 l 528 0 l 528 229 l 532 304 l 532 1010 l 733 1010 l 733 0 z "},"5":{ha:852,x_min:62,x_max:806,o:"m 429 -14 l 429 -14 q 242 25 324 -14 q 112 131 160 63 q 62 286 64 199 l 62 286 l 270 286 q 318 191 273 227 q 429 155 364 155 l 429 155 q 517 177 479 155 q 577 239 555 199 q 599 332 599 279 l 599 332 q 576 425 599 385 q 515 489 554 466 q 425 511 476 511 l 425 511 q 339 493 380 511 q 275 444 298 475 l 275 444 l 84 477 l 132 1010 l 749 1010 l 749 836 l 308 836 l 283 583 l 288 583 q 369 644 315 620 q 489 669 422 669 l 489 669 q 651 626 580 669 q 764 509 723 583 q 806 337 806 434 l 806 337 q 758 156 806 235 q 626 32 711 77 q 429 -14 541 -14 z "},"6":{ha:875,x_min:47,x_max:828,o:"m 450 -14 l 450 -14 q 300 12 373 -14 q 171 96 228 38 q 80 249 114 153 q 47 482 47 344 l 47 482 q 76 710 47 610 q 158 881 104 810 q 288 987 212 951 q 458 1024 364 1024 l 458 1024 q 636 985 559 1024 q 761 878 713 945 q 817 728 808 811 l 817 728 l 608 728 q 555 811 595 781 q 458 841 515 841 l 458 841 q 308 755 359 841 q 256 522 256 669 l 256 522 l 263 522 q 325 599 286 567 q 412 648 363 631 q 517 665 462 665 l 517 665 q 677 623 607 665 q 788 507 747 581 q 828 338 828 433 l 828 338 q 780 156 828 236 q 648 32 732 77 q 450 -14 563 -14 z m 449 155 l 449 155 q 537 178 498 155 q 598 242 576 201 q 621 333 621 283 l 621 333 q 599 423 621 383 q 538 487 576 463 q 450 510 500 510 l 450 510 q 362 486 401 510 q 300 421 323 462 q 277 332 277 381 l 277 332 q 300 243 277 283 q 361 178 322 202 q 449 155 400 155 z "},"7":{ha:766,x_min:30,x_max:739,o:"m 320 0 l 99 0 l 517 829 l 517 836 l 30 836 l 30 1010 l 739 1010 l 739 833 l 320 0 z "},"8":{ha:877,x_min:47,x_max:830,o:"m 438 -14 l 438 -14 q 236 24 324 -14 q 97 125 148 61 q 47 272 47 190 l 47 272 q 76 388 47 335 q 154 476 104 441 q 266 522 204 511 l 266 522 l 266 528 q 134 607 185 545 q 83 752 83 670 l 83 752 q 129 892 83 831 q 255 989 175 954 q 438 1024 336 1024 l 438 1024 q 621 989 541 1024 q 747 892 701 954 q 793 752 793 830 l 793 752 q 742 607 793 669 q 611 528 690 545 l 611 528 l 611 522 q 722 476 672 511 q 801 388 771 441 q 830 272 830 335 l 830 272 q 780 125 830 190 q 641 24 729 61 q 438 -14 552 -14 z m 438 143 l 438 143 q 527 161 489 143 q 586 213 565 180 q 608 289 608 245 l 608 289 q 586 366 608 332 q 525 419 564 399 q 438 438 487 438 l 438 438 q 351 419 389 438 q 291 366 313 400 q 269 289 269 332 l 269 289 q 290 213 269 245 q 350 162 311 180 q 438 143 388 143 z m 438 594 l 438 594 q 514 611 481 594 q 566 659 547 629 q 585 730 585 690 l 585 730 q 566 799 585 769 q 514 846 547 829 q 438 863 481 863 l 438 863 q 362 846 395 863 q 310 799 329 829 q 292 730 292 769 l 292 730 q 311 659 292 690 q 362 611 330 629 q 438 594 395 594 z "},"9":{ha:875,x_min:47,x_max:828,o:"m 425 1025 l 425 1025 q 575 999 503 1025 q 704 915 647 973 q 795 762 762 857 q 828 529 828 667 l 828 529 q 799 300 828 401 q 716 130 770 200 q 587 22 663 59 q 418 -15 511 -15 l 418 -15 q 239 25 317 -15 q 115 132 161 64 q 58 283 68 200 l 58 283 l 268 283 q 320 199 280 229 q 418 168 359 168 l 418 168 q 568 255 517 168 q 618 489 618 341 l 618 489 l 612 489 q 551 413 590 445 q 463 363 513 380 q 358 347 414 347 l 358 347 q 198 389 269 347 q 87 504 127 431 q 47 673 47 578 l 47 673 q 95 855 47 775 q 228 980 142 935 q 425 1025 313 1026 z m 426 856 l 426 856 q 338 832 378 856 q 277 769 299 809 q 254 678 254 728 l 254 678 q 276 588 254 628 q 337 525 298 548 q 425 501 376 501 l 425 501 q 513 525 474 501 q 575 590 552 549 q 598 680 598 630 l 598 680 q 576 768 598 728 q 515 832 553 808 q 426 856 476 856 z "},",":{ha:445,x_min:57,x_max:326,o:"m 199 -269 l 57 -269 l 117 154 l 326 154 l 199 -269 z "},".":{ha:423,x_min:92,x_max:331,o:"m 212 -13 l 212 -13 q 127 21 161 -13 q 92 105 92 55 l 92 105 q 127 189 92 155 q 212 223 161 223 l 212 223 q 296 189 262 223 q 331 105 331 155 l 331 105 q 296 21 331 55 q 212 -13 262 -13 z "}},familyName:"Inter Tight Bold",ascender:1345,descender:-335,underlinePosition:0,underlineThickness:0,boundingBox:{xMin:0,xMax:0,yMin:0,yMax:0},resolution:1000};var Y9=new B0(nZ),x5=1,eJ=28,I0=10,EX=`
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`,FX=`
	uniform float uTime;
	uniform float uOpacity;
	uniform float uLight;
	uniform float uHand;
	uniform vec3 uPage;
	uniform float uLit;
	uniform float uLine;
	uniform float uWave;
	uniform float uPhase;
	uniform float uCurve;
	uniform float uDaysA[30];
	uniform float uDaysB[30];
	uniform float uDaysMix;
	uniform vec3 uTone;
	uniform float uToneMix;
	uniform float uSessions;
	uniform float uLift;
	uniform vec3 uTintA;
	uniform vec3 uTintB;
	uniform vec3 uTintC;
	uniform vec2 uTintDir;
	uniform float uTint;
	uniform sampler2D uField;
	uniform vec2 uFieldSize;
	uniform vec2 uSize;
	varying vec2 vUv;

	vec3 glimm(float t) {
		vec3 blue = vec3(0.180, 0.439, 1.0);
		vec3 indigo = vec3(0.482, 0.310, 1.0);
		vec3 purple = vec3(0.827, 0.235, 1.0);
		vec3 pink = vec3(1.0, 0.239, 0.753);
		t = 1.0 - abs(1.0 - 2.0 * fract(t));
		if (t < 0.333) return mix(blue, indigo, t / 0.333);
		if (t < 0.666) return mix(indigo, purple, (t - 0.333) / 0.333);
		return mix(purple, pink, (t - 0.666) / 0.334);
	}

	float dayAt(float x) {
		float u = clamp(x / (uSize.x * 0.8) + 0.5, 0.0, 1.0) * 29.0;
		float i = floor(u);
		float f = u - i;
		float a = 0.0;
		float b = 0.0;
		float c = 0.0;
		float e = 0.0;
		for (int k = 0; k < 30; k++) {
			float fk = float(k);
			float v = mix(uDaysA[k], uDaysB[k], uDaysMix);
			if (fk == max(i - 1.0, 0.0)) a = v;
			if (fk == i) b = v;
			if (fk == min(i + 1.0, 29.0)) c = v;
			if (fk == min(i + 2.0, 29.0)) e = v;
		}
		return b + 0.5 * f * (c - a + f * (2.0 * a - 5.0 * b + 4.0 * c - e + f * (3.0 * (b - c) + e - a)));
	}

	// An agent's three colors run along uTintDir across the glow behind the
	// tiles (about ±25% of the width and height), not the whole scene, so its
	// outer colors show too: (1, 0) is left to right, (1, 1) bottom left to
	// top right.
	vec3 tintAt(vec2 p) {
		vec2 q = p / (uSize * 0.25);
		float s = dot(q, uTintDir) / max(abs(uTintDir.x) + abs(uTintDir.y), 1e-4);
		float t = clamp(s * 0.5 + 0.5, 0.0, 1.0) * 2.0;
		return t < 1.0 ? mix(uTintA, uTintB, t) : mix(uTintB, uTintC, t - 1.0);
	}

	float crestAt(float x) {
		float w = uPhase;
		return mix(0.55 * sin(x * 0.42 + w * 0.22) + 0.32 * sin(x * 0.9 - w * 0.17 + 1.3) + 0.15, 0.75 - clamp(dayAt(x), 0.0, 1.0) * 1.5, uCurve) + uLift + uHand * uHand * uSize.y * 0.26;
	}

	void main() {
		vec2 p = (vUv - 0.5) * uSize;
		float t = uTime;
		float w = uPhase;
		float crest = crestAt(p.x);
		float d = -p.y - crest;
		vec2 spread = p / vec2(uSize.x * 0.42, uSize.y * 0.48);
		float falloff = exp(-dot(spread, spread) * 2.4);
		float body = mix(falloff, smoothstep(0.25, -0.35, d) * smoothstep(-3.2, -0.4, d) * falloff, uWave);
		float fringe = exp(-abs(d + 0.06) / 0.05) * falloff * uWave * (1.0 - smoothstep(0.55, 1.0, uHand));
		vec3 tint = tintAt(p);
		vec3 color = mix(vec3(0.0905), tint * 0.22, uTint) * body * (1.0 - uHand);
		vec3 lineTone = mix(mix(mix(vec3(0.5), glimm(p.x * 0.05 + t * 0.02), uLine), uTone, uToneMix), tint, uTint);
		float depth = max(d, 0.0);
		float water = smoothstep(-0.05, 0.25, d) * uWave;
		float under = water * falloff;
		vec2 ripple = vec2(
			sin(p.y * 5.0 + w * 1.4 + sin(p.x * 1.1 + w * 0.6) * 1.6),
			cos(p.x * 3.2 - w * 1.1 + p.y * 1.7)
		) * (0.02 + min(depth, 2.5) * 0.018) * water;
		vec2 q = p + ripple - vec2(0.0, uHand * uSize.y * 0.22);
		vec2 cell = floor(q / 0.16);
		vec2 grid = fract(q / 0.16) - 0.5;
		float radius = 0.12 + min(depth, 2.5) * 0.05 * water;
		float pip = smoothstep(radius, 0.04 * (1.0 - water), length(grid)) * pow(0.12 / radius, 1.5) * (1.0 - smoothstep(0.0, 0.75, uHand));
		float seed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453) * 0.96;
		float lit = smoothstep(seed, seed + 0.04, uLit);
		float spark = lit - smoothstep(seed + 0.04, seed + 0.14, uLit);
		vec3 dotTone = mix(vec3(1.0), glimm(q.x * 0.05 + q.y * 0.04 + t * 0.08) * (5.0 + spark * 4.0), lit);
		if (uSessions > 0.001) {
			vec2 centre = (cell + 0.5) * 0.16;
			float row = floor((centre.y + crestAt(centre.x)) / 0.16);
			float col = floor((centre.x + uSize.x * 0.4) / 0.16);
			vec4 slot = vec4(0.0);
			if (row >= 0.0 && row < uFieldSize.y && col >= 0.0 && col < uFieldSize.x) slot = texture2D(uField, (vec2(col, row) + 0.5) / uFieldSize);
			vec3 sessionTone = slot.r > 0.5 ? mix(vec3(1.6), uTone * 9.0, slot.g) : vec3(0.3);
			dotTone = mix(dotTone, sessionTone, uSessions);
		}
		dotTone = mix(dotTone, mix(vec3(1.0), tintAt(q) * (5.0 + spark * 4.0), lit), uTint);
		vec3 tide = mix(vec3(1.0), vec3(0.62, 0.74, 1.0), water) * exp(-depth * 0.25 * water);
		color += vec3(0.0905) * under * 0.5;
		color += dotTone * tide * pip * (body * 0.9 + fringe * 0.6 + under * 0.6) * 0.22;
		color += lineTone * fringe * 0.42;
		if (uLight > 0.5) {
			float luma = dot(color, vec3(0.299, 0.587, 0.114));
			vec3 lifted = clamp(vec3(1.0 - luma * 0.7) + (color - luma), 0.0, 1.0) * uPage;
			gl_FragColor = vec4(mix(uPage, lifted, uOpacity), 1.0);
		} else {
			gl_FragColor = vec4(color * uOpacity, 1.0);
		}
	}
`,B6=()=>performance.now()/1000,sZ=(J)=>{let Q=Math.min(1,Math.max(0,J));return Q*Q*(3-2*Q)},iZ=2.8,DX=1.8,OX=2.6,g5=1.6,RX=0.7,oZ=(J)=>requestAnimationFrame(J),MX=(J)=>cancelAnimationFrame(J);function kX(J,Q,$={}){let Z={appear:$.number?1:0,shown:null,badge:0,badgeShown:null,lit:$.lit?1:0,curve:$.days?1:0,curving:null,last:null,born:null,finish:$.lit?{start:-10,from:1}:null},W=new rJ({antialias:!0,alpha:!1,powerPreference:"high-performance"});W.setPixelRatio(Math.min(window.devicePixelRatio||1,2)),W.toneMapping=H0,W.toneMappingExposure=1.05,W.outputColorSpace=v9,W.setClearColor(0,1);let q=W.domElement;q.className="glass-canvas",J.append(q);let K=new f9,H=new p9(W);K.environment=H.fromScene(new tJ,0.04).texture,K.environmentIntensity=0.07;let U=new x6(eJ,1,0.1,100);U.position.set(0,0,I0);let Y=new M6(new Z9(1,1),new Z7({vertexShader:EX,fragmentShader:FX,uniforms:{uTime:{value:0},uOpacity:{value:1},uLight:{value:0},uHand:{value:0},uPage:{value:new r8(16579836)},uLit:{value:$.lit?1:0},uLine:{value:$.lit?1:0},uWave:{value:1},uPhase:{value:0},uCurve:{value:$.days?1:0},uDaysA:{value:$.days?[...$.days]:Array(30).fill(0)},uDaysB:{value:$.days?[...$.days]:Array(30).fill(0)},uDaysMix:{value:0},uTone:{value:new r8(1,1,1)},uToneMix:{value:0},uSessions:{value:0},uLift:{value:0},uTintA:{value:new r8},uTintB:{value:new r8},uTintC:{value:new r8},uTintDir:{value:new L8(1,0)},uTint:{value:0},uField:{value:null},uFieldSize:{value:new L8(1,1)},uSize:{value:new L8(1,1)}},depthWrite:!1}));Y.position.z=-6,K.add(Y);let X=new g9(16777215,g5,0,0);X.position.set(-3,4,6),K.add(X);let G=new S5(9413375,0.6);G.position.set(4,-2,3),K.add(G);let N=new I5({color:5593182,metalness:1,roughness:0.3,clearcoat:0.12,clearcoatRoughness:0.12,transparent:!0}),F=new r8(15132393),M=new r8(5593182),L=Boolean($.light),E=()=>{let Y8=X.position.clone().project(U),Z8=J.getBoundingClientRect();return{x:Z8.left+(Y8.x+1)/2*Z8.width,y:Z8.top+(1-Y8.y)/2*Z8.height}},O=(Y8,Z8=0)=>$.onLight?.(Y8,Z8,E()),_=(Y8)=>{if(L=Y8,Y8&&!Z.lighting&&Z.light===0)Z.badge=0,O(1);Y.material.uniforms.uLight.value=Y8?1:0,W.setClearColor(Y8?16579836:0,1),F.set(Y8?2697775:15132393),M.set(Y8?13225170:5593182),K.environmentIntensity=Y8?0.45:0.07,J8?.color.copy(M)},V=new Map,B=(Y8)=>{if(!V.has(Y8)){let Z8=new h5(Y8,{font:Y9,size:1,depth:0.2,curveSegments:14,bevelEnabled:!0,bevelThickness:0.035,bevelSize:0.016,bevelSegments:8});Z8.computeVertexNormals(),V.set(Y8,Z8)}return V.get(Y8)},w=(Y8)=>(Y9.data.glyphs[Y8]?.ha??600)/Y9.data.resolution*x5,y=B("0");y.computeBoundingBox();let D=y.boundingBox.max.y,z="0123456789",m=-0.05*(1388.888888888889/Y9.data.resolution)*x5,t=Math.max(...[...z].map(w))+m,v=D*0.8,J8=N.clone(),E8=new K7;{let Y8=new V0().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 350 347"><path fill-rule="evenodd" d="${cZ}"/></svg>`),Z8=v/347,A8=new $9(V0.createShapes(Y8.paths[0]),{depth:0.2/Z8,curveSegments:32,bevelEnabled:!0,bevelThickness:0.035/Z8,bevelSize:0.016/Z8,bevelSegments:8});A8.scale(Z8,Z8,Z8),A8.rotateX(Math.PI),A8.center(),A8.computeVertexNormals(),E8.add(new M6(A8,J8)),K.add(E8)}let T=X.position.clone(),H8=new u(-T.x,T.y,T.z),e=()=>{if(X.position.equals(T))return;let Y8=X.position.clone();l("key",0,1,1.4,(Z8)=>{X.position.lerpVectors(Y8,T,Z8),O(1)})};if(Z.light=0,$.badge&&!L&&!$.lit)Z.badge=1;O(Z.badge&&!$.lit?0:1);let S=(Y8,Z8=!1)=>{if(Z.badgeShown?.done(),Z.badgeShown=null,Z.lighting?.done(),Z.lighting=null,X.intensity=g5,!Z8)e();if(!Z8||!Y8||L){if(Y8)Z.light=1;return new Promise((A8)=>{Z.badgeShown={from:Z.badge,to:Y8?1:0,start:B6(),done:A8}})}return Z.badge=1,new Promise((A8)=>{Z.lighting={start:B6(),done:A8}})};if($.badge&&$.lit)S(!0);_(Boolean($.light));let B8=new K7,i=new K7;i.add(B8),K.add(i);let X8=0,V8="";function v8(Y8){if(Y8===V8)return;V8=Y8,B8.clear();let Z8=0;for(let A8 of Y8){let Q8=Y9.data.glyphs[A8],m8=z.includes(A8),f8=m8?t:w(A8);if(Q8){let j8=new M6(B(A8),N),l8=(Q8.x_max-Q8.x_min)/Y9.data.resolution*x5;j8.position.x=m8?Z8+(f8-l8)/2-Q8.x_min/Y9.data.resolution*x5:Z8,B8.add(j8)}Z8+=f8}X8=Z8,B8.position.x=-X8/2,B8.position.y=-D/2,B8.position.z=-0.1}let U8=()=>q.clientHeight/(2*I0*Math.tan(U5.degToRad(eJ/2))),M8={scale:1,x:0,y:0,badge:1};function b8(){let Y8=J.getBoundingClientRect(),Z8=Q.getBoundingClientRect();if(q.width!==Math.round(Y8.width*W.getPixelRatio())||q.height!==Math.round(Y8.height*W.getPixelRatio()))W.setSize(Y8.width,Y8.height,!1);U.aspect=Y8.width/Math.max(1,Y8.height),U.updateProjectionMatrix();let A8=U8(),Q8=2*I0*Math.tan(U5.degToRad(eJ/2))*(I0+6)/I0;if(Y.scale.set(Q8*U.aspect,Q8,1),Y.material.uniforms.uSize.value.set(Q8*U.aspect,Q8),s?.perDay)N8();let m8=Z8.height*0.62,f8=X8*(m8/D),j8=Math.min(m8,Z8.width*0.92*m8/Math.max(1,f8));M8.scale=j8/D/A8,M8.badge=m8/D/A8,M8.x=(Z8.left+Z8.width/2-(Y8.left+Y8.width/2))/A8,M8.y=-(Z8.top+Z8.height/2-(Y8.top+Y8.height/2))/A8}let n={target:{x:0,y:0},value:{x:0,y:0},velocity:{x:0,y:0}},d=(Y8)=>{let Z8=J.getBoundingClientRect(),A8=Math.max(-1,Math.min(1,(Y8.clientX-Z8.left)/Z8.width*2-1)),Q8=Math.max(-1,Math.min(1,(Y8.clientY-Z8.top)/Z8.height*2-1));n.target.y=A8*0.12,n.target.x=Q8*0.05},P=()=>{n.target.x=0,n.target.y=0};window.addEventListener("pointermove",d),document.documentElement.addEventListener("pointerleave",P);let C={to:null,start:0,duration:0,ease:(Y8)=>Y8,done:null,reverse:!1,base:0},g=0;function K8(Y8){let Z8=J.getBoundingClientRect(),A8=U8(),Q8=Y8.capHeight/D/A8,m8=(Y8.left-(Z8.left+Z8.width/2))/A8,f8=-(Y8.baseline-(Z8.top+Z8.height/2))/A8;return{scale:Q8,x:m8+X8/2*Q8,y:f8+D/2*Q8}}function D8(Y8,{duration:Z8,ease:A8,reverse:Q8}){return new Promise((m8)=>{Object.assign(C,{to:K8(Y8),start:B6(),duration:Z8/1000,ease:A8,done:m8,reverse:Q8})})}Z.base=$.days?[...$.days]:null;let A=new Map,l=(Y8,Z8,A8,Q8,m8)=>{A.set(Y8,{from:Z8,to:A8,start:B6(),duration:Q8,apply:m8}),m8(Z8)},j=()=>{for(let[Y8,Z8]of A){let A8=Math.min(1,(B6()-Z8.start)/Z8.duration);if(Z8.apply(Z8.from+(Z8.to-Z8.from)*A8*A8*(3-2*A8)),A8>=1)A.delete(Y8)}},o=15,s={perDay:null,texture:null,cols:0},q8=(Y8,Z8)=>{let A8=Math.sin(Y8*12.9898+Z8*78.233)*43758.5453;return A8-Math.floor(A8)};function N8(){if(!s.perDay)return;let Y8=Y.material.uniforms,Z8=Y8.uSize.value.x*0.8,A8=Math.max(1,Math.ceil(Z8/0.16));if(A8!==s.cols)s.texture?.dispose(),s.texture=new h9(new Uint8Array(A8*o*4),A8,o,Q7),s.texture.magFilter=e6,s.texture.minFilter=e6,s.cols=A8;let Q8=s.texture.image.data;Q8.fill(0);let m8=Array.from({length:30},()=>[]);for(let j8=0;j8<A8;j8+=1){let l8=-Z8/2+(j8+0.5)*0.16,I=Math.round(Math.min(1,Math.max(0,l8/Z8+0.5))*29);m8[I].push(j8)}let f8=m8.map((j8)=>{let l8=[];for(let I=0;I<o;I+=1)for(let R of j8)if(q8(R,I)>0.1)l8.push([R,I]);return l8});s.perDay.forEach((j8,l8)=>{let I=Math.max(1,Math.ceil(j8.length/Math.max(1,f8[l8].length)));for(let R=0;R*I<j8.length;R+=1){let c=f8[l8][R];if(!c)break;let z8=Math.max(...j8.slice(R*I,R*I+I)),R8=(c[1]*A8+c[0])*4;Q8[R8]=255,Q8[R8+1]=Math.round(Math.min(1,Math.max(0,z8))*255),Q8[R8+3]=255}}),s.texture.needsUpdate=!0,Y8.uField.value=s.texture,Y8.uFieldSize.value.set(A8,o)}let h=B6(),x=0,k8=()=>{if(x=oZ(k8),!J.offsetParent||J.dataset.paused!==void 0)return;let Y8=B6()-h;if(Y.material.uniforms.uTime.value=Y8,j(),Z.curving){let l8=Math.min(1,(B6()-Z.curving)/2.2);if(Z.curve=l8*l8*(3-2*l8),l8>=1)Z.curving=null}let Z8=Z.last===null?0:Math.min(0.05,B6()-Z.last);if(Z.last=B6(),Y.material.uniforms.uPhase.value+=Z8*(1-Z.curve),Y.material.uniforms.uCurve.value=Z.curve,Z.shown){let l8=Math.min(1,(B6()-Z.shown.start)/1.8);if(Z.appear=Z.shown.from+(Z.shown.to-Z.shown.from)*(1-(1-l8)**3),l8>=1){let I=Z.shown.done;Z.shown=null,I()}}if(C.to){let l8=Math.min(1,Math.max(0,(B6()-C.start)/C.duration)),I=C.ease(l8);if(g=C.reverse?1-I:I,l8>=1&&C.done){let R=C.done;C.done=null,R()}}else g=C.base;let A8={scale:M8.scale,x:M8.x,y:M8.y},Q8=C.to??A8,m8=1-Z.appear;i.scale.setScalar((A8.scale+(Q8.scale-A8.scale)*g)*(1-m8*0.12)),i.position.set(A8.x+(Q8.x-A8.x)*g,A8.y+(Q8.y-A8.y)*g-m8*0.35,-m8*2.4);for(let l8 of["x","y"])n.velocity[l8]+=(n.target[l8]-n.value[l8])*0.012,n.velocity[l8]*=0.9,n.value[l8]+=n.velocity[l8];let f8=1-g;if(i.rotation.set((-0.08+n.value.x)*f8+m8*0.45,n.value.y*f8,0),Z.lighting){let l8=B6()-Z.lighting.start;Z.light=sZ(l8/DX);let I=sZ(l8/iZ),R=1-I*I,c=M8.badge*v;if(X.position.set((M8.x+c*(4.8*I-2.4))*R+H8.x*(1-R),(M8.y+c*0.25)*R+H8.y*(1-R),OX*R+H8.z*(1-R)),X.intensity=g5*(1-RX*R),O(Z.light,R),l8>=iZ){let{done:z8}=Z.lighting;Z.lighting=null,X.intensity=g5,O(1),z8()}}if(Z.badgeShown){let l8=Math.min(1,(B6()-Z.badgeShown.start)/1.4);if(Z.badge=Z.badgeShown.from+(Z.badgeShown.to-Z.badgeShown.from)*(1-(1-l8)**3),l8>=1){let I=Z.badgeShown.done;Z.badgeShown=null,I()}}if(Z.finish){let l8=B6()-Z.finish.start,I=Math.min(1,l8/0.9);Z.lit=Z.finish.from+(1-Z.finish.from)*I*I*(3-2*I);let R=Math.min(1,Math.max(0,(l8-0.5)/1.6));Y.material.uniforms.uLine.value=R*R*(3-2*R)}else Z.born??=B6(),Z.lit=0.9*(1-Math.exp(-Math.max(0,B6()-Z.born-1)/3.2));Y.material.uniforms.uLit.value=Z.lit;let j8=1-Z.badge;E8.visible=Z.badge>0.001,E8.scale.setScalar(M8.badge*(1-j8*0.12)),E8.position.set(M8.x,M8.y-j8*0.35,-j8*2.4),E8.rotation.set(-0.08+n.value.x+j8*0.45,n.value.y,0),J8.opacity=Z.badge,J8.color.copy(M).multiplyScalar(Z.light),J8.clearcoat=0.12*Z.light,N.opacity=Z.appear,B8.visible=Z.appear>0.001,N.color.lerpColors(M,F,g),N.roughness=0.14+g*0.5,Y.material.uniforms.uOpacity.value=1-g,W.render(K,U)},f=new ResizeObserver(b8);return f.observe(J),f.observe(Q),b8(),x=oZ(k8),{set(Y8){v8(Y8),b8()},element:q,capRatio:0.727,fly:D8,settle(Y8){C.to=null,C.base=Y8,g=Y8},curve(Y8){if(Z.curve>0||Z.curving)return;let Z8=Y.material.uniforms;Z8.uDaysA.value=[...Y8],Z8.uDaysB.value=[...Y8],Z.curving=B6(),Z.base=[...Y8]},metric(Y8){let Z8=Y.material.uniforms,A8=Z8.uDaysMix.value;if(Z8.uDaysA.value=Z8.uDaysA.value.map((Q8,m8)=>Q8+(Z8.uDaysB.value[m8]-Q8)*A8),Z8.uDaysB.value=[...Y8?.days??Z.base??Z8.uDaysA.value],Z8.uDaysMix.value=0,l("days",0,1,1.3,(Q8)=>Z8.uDaysMix.value=Q8),Y8){let Q8=Z8.uTone.value.clone(),m8=new r8(...Y8.tone),f8=Z8.uToneMix.value;l("tone",0,1,1.3,(j8)=>{Z8.uTone.value.copy(f8>0.001?Q8.clone().lerp(m8,j8):m8),Z8.uToneMix.value=f8+(1-f8)*j8}),s.perDay=Y8.sessions,N8(),l("sessions",Z8.uSessions.value,1,0.9,(j8)=>Z8.uSessions.value=j8),l("lift",Z8.uLift.value,0.7,1.3,(j8)=>Z8.uLift.value=j8)}else l("lift",Z8.uLift.value,0,1.3,(Q8)=>Z8.uLift.value=Q8),l("tone",Z8.uToneMix.value,0,1.3,(Q8)=>Z8.uToneMix.value=Q8),l("sessions",Z8.uSessions.value,0,0.9,(Q8)=>Z8.uSessions.value=Q8)},theme:_,tint(Y8,Z8=0.9,A8=[1,0]){let Q8=Y.material.uniforms,m8=[Q8.uTintA.value,Q8.uTintB.value,Q8.uTintC.value],f8=m8.map((I8)=>I8.clone()),j8=Y8?Y8.map((I8)=>new r8(I8)):f8,l8=Q8.uTintDir.value,I=l8.clone(),R=Y8?new L8(...A8):I,c=Q8.uTint.value,z8=Y8?1:0,R8=c>0.001;l("tint",0,1,Z8,(I8)=>{m8.forEach((P8,W8)=>P8.copy(R8?f8[W8].clone().lerp(j8[W8],I8):j8[W8])),l8.copy(R8?I.clone().lerp(R,I8):R),Q8.uTint.value=c+(z8-c)*I8})},handoff(Y8=1.1,Z8=1){let A8=Y.material.uniforms.uHand.value;return new Promise((Q8)=>{l("hand",A8,Z8,Y8,(m8)=>{if(Y.material.uniforms.uHand.value=m8,Math.abs(m8-Z8)<0.000001)Q8()})})},finish(){if(Z.finish)return Promise.resolve();if(Z.finish={start:B6(),from:Z.lit},!$.badge)return new Promise((Y8)=>setTimeout(Y8,900));return new Promise((Y8)=>setTimeout(Y8,700)).then(()=>S(!0,!0))},badge:S,appear(Y8){return Z.shown?.done(),new Promise((Z8)=>{Z.shown={from:Z.appear,to:Y8?1:0,start:B6(),done:Z8}})},destroy(){X.position.copy(T),O(1),MX(x),f.disconnect(),window.removeEventListener("pointermove",d),document.documentElement.removeEventListener("pointerleave",P);for(let Y8 of V.values())Y8.dispose();N.dispose(),s.texture?.dispose(),J8.dispose();for(let Y8 of E8.children)Y8.geometry.dispose();Y.geometry.dispose(),Y.material.dispose(),H.dispose(),W.dispose(),q.remove()}}}window.glass3d={mount:kX};})();
