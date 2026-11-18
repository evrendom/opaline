import opalineWordmarkUrl from "../../../../../marketing/src/assets/opaline-wordmark-nav-small.svg?url";
import opalineWordmarkDarkUrl from "../../../../../marketing/src/assets/opaline-wordmark-nav-small-dark.svg?url";
import "../product-window-chrome.css";

// Both wordmarks render and CSS shows the one for the current theme, so the
// markup is the same in light and dark (the demo is server-rendered).
export function ProductBrand() {
	return (
		<span className="product-brand-lockup">
			<span className="product-brand-wordmark">
				<img alt="Opaline" data-theme-asset="light" src={opalineWordmarkUrl} />
				<img
					alt="Opaline"
					data-theme-asset="dark"
					src={opalineWordmarkDarkUrl}
				/>
			</span>
		</span>
	);
}
