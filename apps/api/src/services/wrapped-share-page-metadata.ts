import type { PublicWrappedShare } from "@rudel/api-routes";
import type { SocialPageMetadata } from "./social-page-metadata.js";

export { injectSocialPageMetadata as injectWrappedSharePageMetadata } from "./social-page-metadata.js";

const WRAPPED_SHARE_IMAGE_HEIGHT = 630;
const WRAPPED_SHARE_IMAGE_TYPE = "image/png";
const WRAPPED_SHARE_IMAGE_WIDTH = 1200;

export function buildWrappedSharePageMetadata(input: {
	imageHeight?: number;
	imageType?: string;
	imageUrl?: string;
	imageWidth?: number;
	publicUrl: string;
	share: PublicWrappedShare;
}): SocialPageMetadata {
	const {
		imageHeight = WRAPPED_SHARE_IMAGE_HEIGHT,
		imageType = WRAPPED_SHARE_IMAGE_TYPE,
		imageUrl,
		imageWidth = WRAPPED_SHARE_IMAGE_WIDTH,
		publicUrl,
		share,
	} = input;
	const { snapshot } = share;
	const displayName = snapshot.row.displayName;
	const title = `${displayName}'s Opaline Wrapped`;
	const description = `${displayName} is a ${snapshot.archetypeLabel}. ${formatCompactMetric(snapshot.row.totalTokens)} tokens across ${formatCompactMetric(snapshot.row.totalSessions)} sessions. Make yours.`;
	const baseMetadata = {
		description,
		publicUrl,
		title,
	};

	if (!imageUrl) {
		return baseMetadata;
	}

	const imageSecureUrl = getSecureImageUrl(imageUrl);

	return {
		...baseMetadata,
		imageAlt: `${displayName}'s Opaline Wrapped card`,
		imageHeight,
		imageType: imageType || WRAPPED_SHARE_IMAGE_TYPE,
		imageUrl,
		imageWidth,
		...(imageSecureUrl ? { imageSecureUrl } : {}),
	};
}

function getSecureImageUrl(imageUrl: string) {
	try {
		const parsedUrl = new URL(imageUrl);

		if (parsedUrl.protocol !== "https:") {
			return undefined;
		}

		return parsedUrl.toString();
	} catch {
		return undefined;
	}
}

function formatCompactMetric(value: number) {
	if (value >= 1_000_000) {
		return `${formatCompactDecimal(value / 1_000_000)}M`;
	}

	if (value >= 1_000) {
		return `${formatCompactDecimal(value / 1_000)}K`;
	}

	return Math.round(value).toString();
}

function formatCompactDecimal(value: number) {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}
