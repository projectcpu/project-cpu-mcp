import type {
    IPayboxAuthStorage,
    IPayboxSdkAdapter,
    PayboxAuthenticateResult,
    PayboxSiweAuthenticator,
} from '../types.js';

export interface PayboxAuthorityOptions {
    storage: IPayboxAuthStorage;
    sdk: IPayboxSdkAdapter;
    authenticator: PayboxSiweAuthenticator;
}

export enum PayboxAuthFlowPollStatus {
    Completed = 'completed',
    Pending = 'pending',
}

export type PayboxAuthFlowPollResult =
    | {
          status: PayboxAuthFlowPollStatus.Completed;
          result: PayboxAuthenticateResult;
      }
    | {
          status: PayboxAuthFlowPollStatus.Pending;
          authorizationUrl: string;
      };
