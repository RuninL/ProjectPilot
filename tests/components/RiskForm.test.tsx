import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RiskForm } from '@/features/risks/components/RiskForm';
import { AppError } from '@/lib/errors';
import type { RiskInput } from '@/services/schemas';
import { makeProject, makeRisk } from '../helpers/fixtures';

const projects = [makeProject({ id: 'p1', name: '内网门户重构' })];

function setup(
  overrides: {
    risk?: ReturnType<typeof makeRisk> | null;
    onSubmit?: (input: RiskInput) => Promise<void>;
  } = {},
) {
  const onSubmit = vi.fn<(input: RiskInput) => Promise<void>>(
    overrides.onSubmit ?? (() => Promise.resolve()),
  );
  const onClose = vi.fn();
  render(
    <RiskForm
      open
      risk={overrides.risk ?? null}
      projects={projects}
      projectId="p1"
      lockProject={false}
      onSubmit={onSubmit}
      onClose={onClose}
    />,
  );
  return { onSubmit, onClose, user: userEvent.setup() };
}

describe('RiskForm', () => {
  it('shows Chinese Zod validation errors before saving', async () => {
    const { onSubmit, user } = setup();

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('风险标题不能为空')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('previews the calculated level and saves normalized risk input', async () => {
    const { onSubmit, onClose, user } = setup();

    await user.type(screen.getByLabelText('风险标题'), '供应商接口延迟');
    fireEvent.change(screen.getByLabelText('可能性'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('影响'), { target: { value: 'high' } });

    expect(await screen.findByText('当前等级：')).toHaveTextContent('当前等级：严重风险');

    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        project_id: 'p1',
        title: '供应商接口延迟',
        description: '',
        category: 'other',
        likelihood: 'high',
        impact: 'high',
        status: 'open',
        owner: '',
        mitigation_plan: '',
        due_date: null,
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('offers only legal target statuses when editing and keeps the dialog open on save errors', async () => {
    const { onClose, user } = setup({
      risk: makeRisk({ status: 'open', title: '现有风险' }),
      onSubmit: () => Promise.reject(new AppError('db', '数据库暂时不可写入')),
    });

    expect(screen.queryByRole('option', { name: '已缓解' })).toBeNull();
    expect(screen.queryByRole('option', { name: '开放' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '监控中' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '已关闭' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(await screen.findByText('数据库暂时不可写入')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
