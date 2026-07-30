import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppFooter } from '@/components/AppFooter';

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

describe('AppFooter', () => {
  beforeEach(() => {
    openUrl.mockReset();
  });

  it('渲染作者与版本号', () => {
    render(<AppFooter />);

    expect(screen.getByText(/Made by Racliu/)).toBeInTheDocument();
    expect(screen.getByText(/v1\.1\.0/)).toBeInTheDocument();
  });

  it('点击邮箱后安全打开 mailto', async () => {
    const user = userEvent.setup();
    render(<AppFooter />);

    await user.click(screen.getByRole('button', { name: 'rliubp@connect.ust.hk' }));

    expect(openUrl).toHaveBeenCalledWith('mailto:rliubp@connect.ust.hk');
    expect(await screen.findByRole('status')).toHaveTextContent('已打开邮件客户端。');
  });

  it('无法打开 mailto 时复制邮箱并显示提示', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    openUrl.mockRejectedValueOnce(new Error('no mail client'));
    render(<AppFooter />);

    await user.click(screen.getByRole('button', { name: 'rliubp@connect.ust.hk' }));

    expect(writeText).toHaveBeenCalledWith('rliubp@connect.ust.hk');
    expect(await screen.findByRole('status')).toHaveTextContent('邮箱已复制到剪贴板。');
  });
});
