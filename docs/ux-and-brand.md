# Hearth UX and brand guide

How Hearth looks, reads and behaves, so every new screen feels like the same app. This guide describes what the app already does. Where the app does more than one thing today, the guide picks one rule and lists the outliers to fix when you are next in that file. New work follows the rule. Don't copy an outlier.

Sources of truth: `src/index.css` (tokens), `components.json` (shadcn, new-york style, stone base, lucide), `src/components/ui/*` (primitives), `brand/` (logo). A good example to copy is `src/components/hearth/Schedules.tsx`.

---

## 1. Brand

**Name.** "Hearth", with a capital H, in prose and in the UI. Use "hearth" in lower case only in code: package names, the `_hearth/*` methods and `@hearth` mentions. Don't use "HearthAI", "Hearth app" or "the Hearth".

**Tagline.** *Your AI, at home.* (README, About). The longer line is: *A polished chat app for any ACP server, where the server owns the chats.*

**What it stands for.** It is your own AI, on your own server, the same on every device. The logo tells the same story: one hearth in the middle, with a monitor, two laptops and two phones around it. Each device is joined to the fire by a warm line, and each screen is lit by the fire.

**Logo** (`brand/logo.svg`, 32 × 32 pixel art; PNGs at 512 and 1024).
- Regenerate it with `node brand/make-logo.mjs && bash brand/render.sh`. Never edit the SVG by hand.
- It is pixel art. Scale it by whole multiples and keep `image-rendering: pixelated`. Don't blur, smooth, recolour, rotate, outline or add a shadow.
- The tile is its own background (night blue `#141A2B` with stepped corners), so it works on light and dark. Don't put it on a busy picture.
- Minimum size is 16 px (favicon). Use 24 to 32 px in the app chrome and 96 px at the top of the README.
- Leave clear space around it of at least a quarter of its width.

**Logo colours.** These belong to the mark only and are not UI tokens.

| Name | Hex | Where |
|---|---|---|
| Night | `#141A2B` | tile |
| Stone | `#EADBC8` / `#BFAE98` | the hearth's arch |
| Flame | `#FFD166` `#F78C2F` `#E4501E` | the fire |
| Screen glow | `#F2A04A` `#FFD49A` | device screens |
| Frame | `#D8E0EC` `#A9B6C9` | device frames |
| Line | `#E08A35` | the warm lines |

**UI palette in one line.** Warm stone neutrals with one ember accent. The orange `primary` is the fire and the stone `background`/`muted` are the hearthstone. There is no second brand colour.

**Tone.** Calm, warm and plain. Hearth is a tool you live with, not a product that sells itself. Show no excitement and no exclamation marks. Never use "AI-powered", "magic", "supercharge" or "seamless".

---

## 2. Wording and voice

- **Plain, short sentences.** Aim for one idea per sentence and fewer than 20 words. Write "Each run is an ordinary session", not "Executions are instantiated as standard sessions".
- **Sentence case** everywhere: buttons, headings, menu items, tabs. Write "Add a server", not "Add A Server". Product and protocol names keep their case (ACP, MCP, GitHub).
- **Say what it does, from the user's side.** Write "Weekdays at 07:15", not `15 7 * * 1-5`. Write "Not connected", not "WebSocket closed (1006)". Put the technical detail in a tooltip, a monospace sub-line or the docs.
- **Verbs.** Pick the word for what really happens:
  - **Add** puts a thing into a list (a server, a job, a provider). "Make a key" (AdminSettings) is the one exception, because a key is generated rather than added.
  - **Remove** takes something off this device or out of a list, and it can be added again.
  - **Delete** destroys it on the server.
  - **Revoke** applies to keys and access only.
  - **Keep** is the "no" in an inline confirm. **Cancel** closes a form or a dialog.
- **Buttons** are verbs or verb phrases: "Run now", "Add a job", "Save". Don't use bare nouns ("Settings…") unless the button opens a place.
- **Ellipsis.** Use "…" (one character, never "...") for loading text ("Reading…") and for a menu item that opens a dialog before acting ("Delete…").
- **Empty states** say what would be here and how to get it, in one line: "No jobs of your own yet. Add a job to run a prompt on a timetable." Don't write "No data".
- **Errors** say what failed in words, then the server's message if it helps. Never blame the user.
- **Times.** Use relative and short near now ("today 18:15", "tomorrow 07:30", "Fri 16:30"), and a date further out ("31 Jan 2027"). Use the 24-hour clock. Put the full date and time in the tooltip (`title`).
- **Jargon.** Explain "cron", "webhook", "MCP" and "OAuth" at first use, or avoid them. *Outliers that need a plainer line:* the hook kind hint with raw JSON (ServerSettings), "Allow auto mode" help (ProjectSettings), "ACP server" on AddServer.

---

## 3. Colour tokens

All colours come from CSS variables in `src/index.css`, used through Tailwind (`bg-card`, `text-muted-foreground`, `border`, …). They are OKLCH and warm (hue 50–70). **Don't use raw Tailwind palette colours** (`amber-500`, `emerald-600`, `zinc-950`) in app UI. Use a token, or add one here first.

| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `oklch(0.985 0.004 70)` | `oklch(0.17 0.008 55)` | page |
| `foreground` | `oklch(0.22 0.012 50)` | `oklch(0.93 0.008 70)` | body text |
| `card` | white | `oklch(0.21 0.009 55)` | lists, cards, forms |
| `popover` | white | `oklch(0.21 0.009 55)` | menus, dialogs |
| `primary` | `oklch(0.64 0.19 42)` ember | `oklch(0.7 0.17 48)` | the one main action, on-switches, links, focus |
| `secondary` / `muted` | `oklch(0.955 0.008 70)` | `oklch(0.25 0.01 55)` | quiet fills, code, chips |
| `muted-foreground` | `oklch(0.52 0.014 55)` | `oklch(0.68 0.012 65)` | meta text, captions, icons |
| `accent` | `oklch(0.945 0.018 60)` | `oklch(0.27 0.014 55)` | hover and the selected nav item |
| `destructive` | `oklch(0.58 0.22 27)` | `oklch(0.65 0.2 27)` | errors, delete, failed |
| `success` | `oklch(0.55 0.13 155)` | `oklch(0.7 0.14 155)` | ran fine, connected, CI passed; dark enough for text |
| `warning` | `oklch(0.72 0.15 75)` | `oklch(0.78 0.14 80)` | near a limit, reconnecting, needs a look: fills, bars, dots, icons |
| `warning-text` | `oklch(0.5 0.11 60)` | `oklch(0.85 0.11 85)` | words in the warning colour (a note on a `bg-warning/10` strip) |
| `admin` / `admin-text` | `oklch(0.6 0.2 12)` / `oklch(0.48 0.17 12)` | `oklch(0.72 0.16 12)` / `oklch(0.84 0.09 12)` | admin threads only: the strip, the sidebar section, the Admin chip. Nothing else is rose |
| `border` / `input` | `oklch(0.91 0.008 70)` | `oklch(0.29 / 0.31 …)` | lines, field borders |
| `ring` | `oklch(0.7 0.16 45)` | `oklch(0.7 0.16 48)` | focus ring (`ring-ring/50`, 3 px) |
| `sidebar*` | slightly darker than `background` | darker still | the left sidebar only |
| `ember` | `oklch(0.7 0.17 50)` | `oklch(0.74 0.16 52)` | brand glow (logo-adjacent), not for controls |

`success`, `warning`, `warning-text` and `admin`/`admin-text` were added with this guide (Nov 2026). `warning` is too light for text on white, so words use `warning-text`.

**Rules**
- One `primary` button per view at most, for its main action. Everything else is `outline` or `ghost`.
- Tints come from a token with opacity: `bg-primary/12` for a selected chip, `bg-destructive/5` with `border-destructive/30` for an error box.
- Status dots are 8 px (`size-2 rounded-full`): `bg-success` on or ok, `bg-primary animate-pulse` running, `bg-destructive` failed, `bg-warning` attention, and a hollow `border border-muted-foreground/60` for off.
- Contrast: body text on `background` and `card` meets WCAG AA in both themes. Don't put `muted-foreground` text on `muted` fills for anything that must be read.

**Raw palette colours.** The app had `emerald-*`, `amber-*`, `rose-*` and `red-500` in several screens. They moved onto `success`, `warning`, `warning-text`, `admin` and `destructive` in Nov 2026.
- Diff and terminal views (ToolViews.tsx: emerald, red, zinc on `zinc-950`) are **allowed** to keep their own palette, because a terminal is dark in both themes. Keep it inside those views.

---

## 4. Type

- **Fonts:** Inter for UI (`font-sans`, with features `cv11` and `ss01`), JetBrains Mono for code, paths, keys and cron (`font-mono`). Both fall back to the system font.
- **Scale.** Use Tailwind steps only. Avoid pixel sizes (`text-[13px]`) except in the sidebar (below).

| Role | Class |
|---|---|
| Page title (one per settings page) | `text-lg font-semibold tracking-tight` (use `SectionHead`) |
| Section heading inside a page | `text-sm font-semibold` |
| Body, list row title | `text-sm`; a row title is `font-medium` |
| Meta, captions, help under a field, timestamps | `text-xs text-muted-foreground` |
| Form label | `text-xs font-medium` |
| Code, paths, cron | `font-mono text-xs` |
| Badge or chip | `text-[11px] font-medium` (the one allowed pixel size outside the sidebar) |
| Big number (stat tile) | `text-xl font-semibold tabular-nums` |
| Welcome or empty hero | `text-xl font-semibold` |

- **Weights:** 400, 500 (`font-medium`) for row titles, labels and the active nav item, and 600 (`font-semibold`) for headings and badges. Don't use bold (700).
- Numbers that change or line up (costs, counts, times) use `tabular-nums`.
- **Sidebar exception.** The sidebar is denser:
  - rows `text-[13px]`;
  - group labels `text-[11px] font-medium uppercase tracking-wider text-muted-foreground`;
  - brand `text-[15px] font-semibold`.
  
  Keep these inside the sidebar.
- ---

## 5. Spacing

Use Tailwind's 4 px scale. Use the steps below and avoid halves except where shown.

| Where | Rule |
|---|---|
| Settings page content | `mx-auto max-w-2xl px-6 py-6`, phones `max-md:px-4` |
| Between page title and content | `mb-4` (built into `SectionHead`) |
| Between sections on a page | `space-y-8`, or `mt-8` before a section |
| Section heading to its list | `mb-2` |
| List row | `px-3 py-2`, or `py-2.5` for two- or three-line rows |
| Card or form padding | `p-4`; a stat tile `p-3` |
| Gap in a row of controls | `gap-2`; icon and text inside a button `gap-1.5` (built in) |
| Field label to field | `space-y-1`; between fields `space-y-3` / `gap-3` |
| Sidebar row | `px-2 py-1.5`; sidebar inset `mx-3` |

**Outliers:**
- History rows `px-3.5 py-2.5` should be `px-3 py-2.5`.
- NewProject uses `max-w-xl`. That is fine for a focused form, but say so in a comment.

---

## 6. Radii and shadows

`--radius` is `0.75rem` (12 px). `rounded-lg` = 12 px, `rounded-md` = 10 px, `rounded-xl` = 16 px.

| Element | Radius |
|---|---|
| Card, list box, form panel, empty box | `rounded-xl` |
| Input, select, textarea, error box, sidebar row, nav item | `rounded-lg` |
| Button (`ui/button`) | `rounded-md` (built in) |
| Chip, badge, status pill, switch, dot | `rounded-full` |
| Dialog | `rounded-lg` (built in) |

**Shadows:** almost none. Hearth is flat with borders.
- `shadow-xs` on outline buttons, the switch and cards that float in a thread (CardView).
- `shadow-md` on menus and popovers, `shadow-lg` on dialogs and the slash menu, `shadow-2xl` on the phone drawer.
- Never use a shadow on a list or a settings card.

---

## 7. Icons

- **lucide-react only.** The one exception is the hand-drawn ring in UsageMeter, which is a chart rather than an icon.
- **Sizes:**
  - `size-3.5` inside `sm` buttons, in list rows and next to `text-xs`/`text-sm`;
  - `size-4` in default buttons, the settings nav and the header;
  - `size-3` in `xs` buttons and chips;
  - `size-5` for the phone menu button.
  
  For empty states use `size-4` inline with the text. Use `size-8` and up only for a full-page empty hero.
- Icons are `text-muted-foreground` unless they are the button's label.
- Icon-only buttons always have an `aria-label` and a `title`.
- **One icon per idea:**
  - Play = run now
  - Trash2 = delete or remove
  - Plus = add
  - RefreshCw = refresh
  - Pencil = rename or edit
  - X = close or cancel
  - Check = done or saved
  - CalendarClock = schedules
  - Zap = triggers
  - Loader2 + `animate-spin` = working

---

## 8. Components

### Buttons (`ui/button`)
- `size="sm"` in settings and lists, and `default` in dialogs and full-page forms.
- **Main action:** `default` (ember). One per view.
- **Secondary:** `outline` (Cancel in a form or dialog, "Add a server" when it is not the page's main action).
- **Quiet or row actions:** `ghost`. Icon-only row actions use `size="icon-sm" variant="ghost"`.
- **Destroy:** a `ghost` trash icon (hover `text-destructive`) opens an inline confirm: "Delete this job? **[Delete]** (destructive, `xs`) [Keep] (ghost, `xs`)". Use a dialog (`ui/dialog`, destructive button) only when the thing is big or the action reaches far, such as deleting a thread or a rewind.
- Use **no `window.confirm`**. The inline confirm is `ConfirmLine` (`components/hearth/ConfirmLine.tsx`). For a warning rather than a delete (saving a hook), pass `destructive={false}` and a plain "Not yet" for the no.
- Raw `<button>` is fine for list rows, nav items and the sidebar, which are not "buttons" visually. Anything that looks like a button uses `Button`. The local icon-button helper `IconBtn` (App) should become `Button size="icon-sm" variant="ghost"`, as `IconAct` (FilesPanel) now is.

### Switch and checkbox
- **`ui/switch`** turns a thing that runs on or off: a schedule, a trigger, a connector, notifications. It needs an `aria-label` naming the thing and its state, and no "On" text beside it.
- **Checkbox** (native, `size-4 accent-primary`) is for choices inside a form ("Always allow", options to send). Write it as `accent-primary`, not `accent-(--primary)`.

### Forms
- **Field:** `h-9 w-full rounded-lg border border-input bg-background px-3 text-sm`, with focus `focus-visible:ring-[3px] focus-visible:ring-ring/50`. A textarea is the same with `py-2`. Monospace inputs (project slug, cron, URL) add `font-mono`.
- **Label above the field** (`text-xs font-medium`), and help below it (`text-xs text-muted-foreground`). Help can be live: the Schedules "When" field shows the cron in words as you type.
- Two fields side by side on wide screens, one column on phones (`grid gap-3 sm:grid-cols-2`).
- **Form panel:** `rounded-xl border bg-card p-4 space-y-3`, actions on the right at the end: [Cancel] outline, then [Save or Add …] default. Disable Save until the form can be sent, and show a spinner in it while sending.
- **In code:** `field` (inputs and selects) and `fieldArea` (textareas) from `ui/field`. Add width or font with `cn(field, 'w-40 font-mono')`. Don't write a local copy.

### Lists
- The list box is `ul.divide-y.rounded-xl.border.bg-card`, with each `li` at `px-3 py-2` (or `py-2.5` when it has two or three lines).
- **Row layout:** an optional status dot or icon, then the text (`min-w-0 flex-1`), then the actions (`shrink-0`, icon buttons, then a switch last).
- **Row text:** title (`text-sm font-medium`), then up to two meta lines (`text-xs text-muted-foreground`) joined with " · ".
- **Rows that are off or done** turn their text `text-muted-foreground`. They are not hidden. Done one-offs collapse under "N done".

### Cards
- **Settings card** (servers, providers): `rounded-xl border bg-card p-4`, with a 32 px icon tile (`size-8 rounded-lg bg-muted`). The current item gets `border-primary/40` and an "In use" chip.
- **Stat tile:** `rounded-xl border bg-card p-3`, with a `text-xs` label over a `text-xl` number.
- **Thread cards** (CardView) are their own pattern: `shadow-xs`, in the chat.

### Empty, loading and error states
- **Empty** is a dashed box, `rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground`, holding one line (optional `size-4` icon). Put it in place of the list, not inside it as a row. Use a full-page empty (icon, title, line) only for a whole view, such as Needs you.
- **Loading** is `Loader2 size-3.5 animate-spin` plus a word: "Reading…", "Loading…", "Searching…". Never show a bare spinner without text, except inside a button. Use `ui/skeleton` for a list that will fill in place (the sidebar).
- **Error** is a box, `rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm` with `role="alert"`, at the top of the section it belongs to. A one-field error goes under the field as `text-xs text-destructive`.
- **Outliers:**
  - Plain-text errors in History.
  - The bare spinner in History.
  - The hand-rolled SidebarSkeleton (App).

### Chips and badges
- `rounded-full px-2 py-0.5 text-[11px] font-medium`, tinted from a token (`bg-primary/12 text-primary`, `bg-muted text-muted-foreground`). Use them for a state ("In use", "Built in"), not for actions.

### Dialogs
- `ui/dialog`, `sm:max-w-md`, a title in sentence case, one line of body, then [Cancel] outline and the action (default or destructive). Only use one for something that needs focus. Prefer inline editing.

---

## 9. Layout

- **App shell:** the sidebar (`w-72`, `bg-sidebar`) on the left and the thread in the middle (`--thread-max-width: 44rem`). The side panel is on the right (plan, files, tasks): `w-[22rem]`, `lg:w-[34rem]` for files, and it opens itself on wide windows.
- **Settings:** a nav (`w-52`, icon `size-4` + label, the selected item `bg-accent font-medium`) and content at `max-w-2xl`. Every section starts with `SectionHead` (title, one-line sub, optional action at the right). Sections the server can't do are not shown. Ones coming soon are shown dimmed with a "soon" label.
- **Inside a settings page:** group things the way the user thinks about them, not the way the server stores them. Each group has a `text-sm font-semibold` heading with an optional count, a one-line `text-xs` sub, then its list or its empty state.
- **Phones (`max-md`, under 768 px):**
  - The sidebar becomes a drawer (`w-[85vw] max-w-80`, with a scrim) opened from a menu button.
  - The settings nav becomes a horizontal scrolling strip.
  - The side panel goes full screen.
  - Content padding drops to `px-4`.
  - Rows keep their actions on the right and let the text wrap. Don't hide actions on phones.
  - Use `max-sm:` only to hide button labels (`sr-only`) where space runs out.
- **Safe areas:** use `pt-safe` and `pb-safe` (index.css). *Outlier:* the header's inline style in App.
- **Check every screen** at 390 px and 1280 px wide, light and dark. In dev, `/#preview/schedules` shows the Schedules screen against made-up data (`src/dev/Preview.tsx`). Add `?theme=dark` and `?frame=390` for the phone width.

---

## 10. Accessibility basics

- Every icon-only control has an `aria-label`. Every switch's label names the thing and says on or off.
- Status is never colour alone. A dot has `aria-label`/`title`, and the row says it in words ("Off", "last run failed").
- Focus stays visible: `focus-visible:ring-[3px] ring-ring/50` on fields, buttons and switches.
- Lists of sections use `section` with `aria-labelledby` the heading.
