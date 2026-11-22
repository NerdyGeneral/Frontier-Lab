import type { CommandPayload } from '../contracts/types';

/** Routine actions already show an authoritative quote in their editor. Keep
 * an extra decision only where the action permanently removes earned work or
 * fixes a choice that cannot be changed later. Expense alone is not a reason
 * to repeat an already visible quote. */
export function getStudioCommandReviewReason(payload: CommandPayload): string | undefined {
  switch (payload.kind) {
    case 'retire_product':
      return 'This empty offer will be retired permanently. Its invoice history stays available, and the portfolio slot becomes free.';
    case 'specialize_staff':
      return 'This career specialty is permanent for this employee.';
    case 'dismiss_staff':
      return 'This employee and their earned experience leave your lab. Two weeks of severance are charged.';
    case 'discard_prepared_release':
      return 'This release preparation cannot resume after it is discarded. Money and work already spent are not refunded.';
    case 'cancel_batch_job':
      return 'This ends the order and settles its final invoice. Unfinished work is credited, and the finite order cannot be accepted again.';
    case 'cancel_agent_job':
      return 'This ends the support job. Work already used remains spent and the same order cannot be restarted.';
    case 'cancel_assurance_contract':
      return 'This ends the contract and its future income. The integration expense is not refunded.';
    default:
      return undefined;
  }
}
