# Workspace shell

`WorkspaceShell` is the reusable application frame for the Wodana web product. It owns the
responsive sidebar, mobile navigation dialog, current-screen header, scroll boundary, and blank
content surface. Product screens supply only their page content.

## Composition

```tsx
<WorkspaceShell
  navigation={workspaceNavigation}
  user={currentUser}
  workspaces={availableWorkspaces}
>
  {children}
</WorkspaceShell>
```

Navigation is configuration-driven through `WorkspaceNavigationSection[]`. Each item has a stable
ID, route, localized label, and icon name. A module can add a destination without duplicating shell
markup or interaction logic.

## Interaction contract

- Desktop uses a fixed, compact sidebar with no floating collapse control.
- Mobile uses a dismissible, focus-contained dialog and never pushes page content sideways.
- `Command/Ctrl + K` focuses navigation search; `Escape` clears and dismisses the search value.
- Groups are keyboard-operable and use `aria-expanded`, `aria-controls`, and focus-safe collapsed
  content.
- Active destinations expose `aria-current="page"`.
- Workspace and account menus use React Aria overlays with focus restoration.
- All motion honors the global reduced-motion tokens and all layout uses logical CSS properties.

The current route files intentionally render an empty named region. Module content is added only
after the screen's information architecture and workflow are approved.
