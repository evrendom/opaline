export function revealInList(row: HTMLElement) {
	let list = row.parentElement;
	while (list && !/(auto|scroll)/u.test(getComputedStyle(list).overflowY))
		list = list.parentElement;
	if (!list) return;
	const at = row.getBoundingClientRect();
	const view = list.getBoundingClientRect();
	if (at.top >= view.top && at.bottom <= view.bottom) return;
	centerInList(list, row);
}

export function centerInList(list: HTMLElement, row: HTMLElement) {
	const at = row.getBoundingClientRect();
	const view = list.getBoundingClientRect();
	list.scrollTop += at.top - view.top - (list.clientHeight - at.height) / 2;
}
