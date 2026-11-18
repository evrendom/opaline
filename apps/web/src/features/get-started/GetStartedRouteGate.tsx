import { Navigate, useLocation } from "react-router-dom";

// Preserve pairing query parameters when following the old setup URL.
export function GetStartedRouteGate() {
	const { search } = useLocation();
	return <Navigate replace to={`/welcome${search}`} />;
}
