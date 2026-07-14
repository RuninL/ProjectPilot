import { LayoutDashboard } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface NavItem {
  to: string;
  label: string;
}

// Only the Dashboard route exists in Phase 1; feature routes arrive in later phases.
const NAV_ITEMS: NavItem[] = [{ to: '/', label: '仪表盘' }];

/** Application shell: sidebar navigation + routed content area. */
export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="flex w-56 flex-col border-r bg-card">
        <div className="flex items-center gap-2 px-4 py-4">
          <LayoutDashboard className="h-5 w-5 text-primary" aria-hidden />
          <span className="text-base font-semibold">ProjectPilot</span>
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
