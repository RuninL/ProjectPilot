import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppLayout, NAV_ITEMS } from '@/components/AppLayout';
import { APP_ROUTES } from '@/router';

const EXPECTED_NAVIGATION = [
  ['仪表盘', '/'],
  ['人物', '/people'],
  ['项目', '/projects'],
  ['任务', '/tasks'],
  ['甘特图', '/gantt'],
  ['日历', '/calendar'],
  ['会议', '/meetings'],
  ['风险', '/risks'],
  ['文件', '/files'],
  ['设置', '/settings'],
] as const;

describe('AppLayout navigation', () => {
  it('keeps the required order and maps every item to an application route', () => {
    expect(NAV_ITEMS.map(({ label, to }) => [label, to])).toEqual(EXPECTED_NAVIGATION);
    const paths = new Set(APP_ROUTES.flatMap((route) => (route.path ? [`/${route.path}`] : ['/'])));
    expect(NAV_ITEMS.every((item) => paths.has(item.to))).toBe(true);
  });

  it('renders the ordered links and highlights a nested route parent', () => {
    render(
      <MemoryRouter initialEntries={['/people/person-1']}>
        <Routes>
          <Route path="*" element={<AppLayout />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(
      EXPECTED_NAVIGATION.map(([label]) => label),
    );
    expect(screen.getByRole('link', { name: '人物' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('我的任务')).toBeNull();
  });
});
