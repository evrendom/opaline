export type SessionDetailNavigation = {
	onPreviousSession: () => void;
	onNextSession: () => void;
	hasPreviousSession: boolean;
	hasNextSession: boolean;
};

export type SessionDetailViewProps = {
	sessionId: string;
	trackView?: boolean;
	navigation?: SessionDetailNavigation;
	onClose?: () => void;
};
