import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { SampleInbox } from './sample-inbox';
it('keeps sample replies local and filters portal conversations', async () => {
  const request = vi.spyOn(globalThis, 'fetch');
  const user = userEvent.setup();
  render(<SampleInbox onClose={() => {}} />);
  await user.type(screen.getByRole('textbox', {name:'Sample message'}), 'A fictional reply');
  await user.click(screen.getByRole('button', {name:'Add sample reply'}));
  expect(screen.getByRole('log')).toHaveTextContent('A fictional reply');
  await user.click(screen.getByRole('button', {name:'Client portal'}));
  expect(screen.queryByRole('button', {name:/Maya Patel/})).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name:/Daniel Brooks/})).toBeVisible();
  expect(request).not.toHaveBeenCalled();
  request.mockRestore();
});
