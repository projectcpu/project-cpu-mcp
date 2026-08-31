import { Network } from './network.types.js';
import { WalletMode } from '../types.js';

export const APP_NAME = 'project-cpu';
export const APP_LOG_PREFIX = 'project-cpu-mcp';
export const SESSION_DIR = '.project-cpu';
export const SESSION_FILE = 'session.json';
export const LOG_FILE = 'project-cpu.log';
export const DEFAULT_API_URL = 'https://api-dev.projectcpu.cc';
export const PAYBOX_ISSUER_URL = 'https://api.paybox.sh';
export const MAX_BATCHES_PER_PROCESS = 1000;
export const BPS_DENOMINATOR = 10_000n;
export const WCPU_RESOURCE_ID = 1;
export const LAUNCH_CHAIN_ID = 4663;
export const LAUNCH_NETWORK = Network.ROBINHOOD;
export const DEFAULT_WALLET_MODE = WalletMode.PAYBOX;
export const OPERATOR_PERSONA_DEFAULT = true;
export const BOOLEAN_ENV_TRUE = 'true';
export const BOOLEAN_ENV_FALSE = 'false';
