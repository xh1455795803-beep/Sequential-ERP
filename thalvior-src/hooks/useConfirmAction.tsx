// useConfirmAction - 封装敏感操作二次确认流程
// 用法:
//   const { confirmModal, runWithConfirm } = useConfirmAction();
//   runWithConfirm(
//     { action: 'order.refund', description: '...', payload: { orderId, amount } },
//     async (token) => orderApi.refund(orderId, { amount, reason, confirmToken: token })
//   );
import { useState } from 'react';
import SensitiveConfirm, { type SensitiveConfirmConfig } from '../components/SensitiveConfirm';

export function useConfirmAction() {
  const [state, setState] = useState<{
    open: boolean;
    config: SensitiveConfirmConfig | null;
    run: ((token: string) => Promise<void> | void) | null;
  }>({ open: false, config: null, run: null });

  const runWithConfirm = (
    config: SensitiveConfirmConfig,
    fn: (token: string) => Promise<any> | any,
  ) => {
    setState({
      open: true,
      config,
      run: async (token: string) => {
        await fn(token);
      },
    });
  };

  const confirmModal = (
    <SensitiveConfirm
      open={state.open}
      config={state.config}
      onClose={() => setState({ open: false, config: null, run: null })}
      onOk={async (token) => {
        if (state.run) await state.run(token);
        setState({ open: false, config: null, run: null });
      }}
    />
  );

  return { confirmModal, runWithConfirm };
}
