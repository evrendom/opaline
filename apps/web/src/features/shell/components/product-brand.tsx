import opalineWordmarkUrl from "../../../../../marketing/src/assets/opaline-wordmark-nav-small.svg?url";
import "../product-window-chrome.css";

export function ProductBrand() {
	return (
		<span className="product-brand-lockup">
			<span className="product-brand-wordmark">
				<img alt="Opaline" src={opalineWordmarkUrl} />
			</span>
		</span>
	);
}
