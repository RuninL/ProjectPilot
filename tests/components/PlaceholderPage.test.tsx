import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlaceholderPage } from '@/components/common/PlaceholderPage';
import { SampleBadge } from '@/components/common/SampleBadge';

describe('PlaceholderPage', () => {
  it('shows the page title and the shared "later phase" notice', () => {
    render(<PlaceholderPage title="日历" description="日历视图将在后续阶段开放。" />);

    expect(screen.getByRole('heading', { level: 1, name: '日历' })).toBeInTheDocument();
    expect(screen.getByText('功能将在后续阶段开放')).toBeInTheDocument();
    expect(screen.getByText('日历视图将在后续阶段开放。')).toBeInTheDocument();
  });
});

describe('SampleBadge', () => {
  it('labels sample rows', () => {
    render(<SampleBadge />);
    expect(screen.getByText('示例')).toBeInTheDocument();
  });
});
