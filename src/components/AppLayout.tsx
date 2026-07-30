import {
  CalendarDays,
  CheckSquare,
  Files,
  FolderKanban,
  GanttChartSquare,
  LayoutDashboard,
  ShieldAlert,
  Settings,
  UserRound,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { AppFooter } from './AppFooter';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard },
  { to: '/people', label: '人物', icon: UserRound },
  { to: '/projects', label: '项目', icon: FolderKanban },
  { to: '/tasks', label: '任务', icon: CheckSquare },
  { to: '/gantt', label: '甘特图', icon: GanttChartSquare },
  { to: '/calendar', label: '日历', icon: CalendarDays },
  { to: '/meetings', label: '会议', icon: Users },
  { to: '/risks', label: '风险', icon: ShieldAlert },
  { to: '/files', label: '文件', icon: Files },
  { to: '/settings', label: '设置', icon: Settings },
];

/** Application shell: sidebar navigation + routed content area. */
export function AppLayout() {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-card">
        <div className="flex items-center gap-2 px-4 py-4">
          <LayoutDashboard className="h-5 w-5 text-primary" aria-hidden />
          <span className="text-base font-semibold">ProjectPilot</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-auto">
        <div className="flex-1">
          <Outlet />
        </div>
        <AppFooter />
      </main>
    </div>
  );
}
