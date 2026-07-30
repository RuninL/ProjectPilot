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
  type LucideIcon,
} from 'lucide-react';

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
