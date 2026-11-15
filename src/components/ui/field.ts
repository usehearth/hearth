// The one text-field look (guide section 8, Forms). `field` is for <input> and <select>, `fieldArea` for <textarea>.
// Add width or font with cn(field, 'w-40 font-mono'); tailwind-merge keeps the later class.
const base = 'w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 aria-invalid:border-destructive';
export const field = `${base} h-9`;
export const fieldArea = `${base} py-2`;
