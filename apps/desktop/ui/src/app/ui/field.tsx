import { cva, type VariantProps } from "class-variance-authority";
import { Label } from "@/app/ui/label";
import { cn } from "@/lib/utils";

const fieldVariants = cva(
	"group/field flex w-full gap-l data-[invalid=true]:text-error",
	{
		variants: {
			orientation: {
				vertical: "flex-col *:w-full [&>.sr-only]:w-auto",
				horizontal:
					"flex-row items-center has-[>[data-slot=field-content]]:items-start *:data-[slot=field-label]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-xxs",
				responsive:
					"flex-col *:w-full @md/field-group:flex-row @md/field-group:items-center @md/field-group:*:w-auto @md/field-group:has-[>[data-slot=field-content]]:items-start @md/field-group:*:data-[slot=field-label]:flex-auto [&>.sr-only]:w-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-xxs",
			},
		},
		defaultVariants: {
			orientation: "vertical",
		},
	},
);

function Field({
	className,
	orientation = "vertical",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
	return (
		<div
			data-slot="field"
			data-orientation={orientation}
			className={cn(fieldVariants({ orientation }), className)}
			{...props}
		/>
	);
}

function FieldLabel({
	className,
	...props
}: React.ComponentProps<typeof Label>) {
	return (
		<Label
			data-slot="field-label"
			className={cn(
				"group/field-label peer/field-label flex w-fit gap-m group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:corner-xl-inner has-[>[data-slot=field]]:edge-m *:data-[slot=field]:p-xl",
				"has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
				className,
			)}
			{...props}
		/>
	);
}

// A group of options under one label: a RadioGroup, or several Checkboxes.
// The legend names the group for assistive tech, so the options need no
// aria-labelledby. Lay the options out on a child (a RadioGroup does it).
function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
	return (
		<fieldset
			data-slot="field-set"
			className={cn("flex min-w-0 flex-col gap-l", className)}
			{...props}
		/>
	);
}

function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
	return (
		<legend
			data-slot="field-legend"
			className={cn("mb-l p-zero text-body-xl font-medium", className)}
			{...props}
		/>
	);
}

export { Field, FieldLabel, FieldLegend, FieldSet };
