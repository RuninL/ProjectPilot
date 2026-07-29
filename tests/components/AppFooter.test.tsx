import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppFooter } from '@/components/AppFooter';

describe('AppFooter', () => {
  it('渲染作者与版本号', () => {
    render(<AppFooter />);

    expect(screen.getByText(/Made by Racliu/)).toBeInTheDocument();
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
  });

  it('点击邮箱后复制并显示提示', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    render(<AppFooter />);

    await user.click(screen.getByRole('button', { name: 'rliubp@connect.ust.hk' }));

    expect(writeText).toHaveBeenCalledWith('rliubp@connect.ust.hk');
    expect(await screen.findByRole('status')).toHaveTextContent('邮箱已复制到剪贴板。');
  });
});
