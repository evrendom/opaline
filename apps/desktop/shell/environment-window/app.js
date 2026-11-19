const form = document.querySelector("form");
const input = form.elements.url;
const message = document.querySelector(".message");
const submit = form.querySelector('button[type="submit"]');

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	submit.disabled = true;
	message.textContent = "Checking…";
	const result = await window.opalineEnvironment
		.connect(input.value)
		.catch((error) => ({ ok: false, message: error.message }));
	submit.disabled = false;
	message.textContent = result.ok ? "" : result.message;
});

form
	.querySelector("[data-cancel]")
	.addEventListener("click", () => window.close());
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") window.close();
});
input.focus();
