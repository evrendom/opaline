import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { DateRangeProvider } from "@/features/analytics/date-range/DateRangeProvider";
import { ProductWindowBackdropProvider } from "@/features/shell/components/product-window-backdrop";
import { OrganizationProvider } from "@/features/workspace/organization/OrganizationProvider";
import { queryClient } from "@/lib/query-client";

type AppProvidersProps = {
	children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<ThemeProvider>
					<ProductWindowBackdropProvider>
						<OrganizationProvider>
							<DateRangeProvider>{children}</DateRangeProvider>
						</OrganizationProvider>
					</ProductWindowBackdropProvider>
				</ThemeProvider>
			</BrowserRouter>
		</QueryClientProvider>
	);
}
