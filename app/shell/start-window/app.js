const detail = document.querySelector(".detail");
const retry = document.querySelector("button");
const message = new URLSearchParams(location.search).get("message")?.trim();

detail.textContent = message ?? "";
detail.hidden = !message;
retry.addEventListener("click", () => {
	retry.disabled = true;
	retry.textContent = "Trying again…";
	window.opalineDesktop?.retryStart?.();
});
