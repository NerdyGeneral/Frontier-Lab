# v42 UI change: docked task pages

- Decision tasks (prepare data, train, evaluate, launch, staffing, Results) no longer
  open as a centered popup with a dimmed, locked background. They open as a docked
  page in the workspace (`StudioTaskSurface docked`), so the sidebar, header and clock
  stay usable. Choosing another destination closes the task and keeps its draft.
- Locked section tabs now show their unlock requirement as a tooltip.
- Default (non-docked) `StudioTaskSurface mode="dialog"` is unchanged, so existing
  dialog semantics and tests still apply wherever `docked` is not passed.
- Engine, content and save schema are untouched.
