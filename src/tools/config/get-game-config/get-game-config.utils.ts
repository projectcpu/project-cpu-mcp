import { PUSH_RANDOMNESS_SUMMARY, SELF_SERVICE_RANDOMNESS_SUMMARY } from './constants.js';
import { type RandomnessDescriptor, RandomnessKind } from '../../../api/types.js';

export function describeRandomnessMode(randomness: RandomnessDescriptor): string {
    return randomness.kind === RandomnessKind.DRAND ? SELF_SERVICE_RANDOMNESS_SUMMARY : PUSH_RANDOMNESS_SUMMARY;
}
