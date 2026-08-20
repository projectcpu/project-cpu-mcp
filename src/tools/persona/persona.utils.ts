import {
    PERSONA_ACTION_LOG_TEMPLATE,
    PERSONA_BASE_SUMMARY_TEMPLATE,
    PERSONA_SECTION_ORDER,
    PERSONA_SECTION_SEPARATOR,
    PERSONA_SECTIONS,
} from './constants.js';
import { PersonaSection } from './types.js';
import { renderPanel } from '../../utils/panel.utils.js';

function sectionText(section: PersonaSection): string {
    if (section !== PersonaSection.Templates) {
        return PERSONA_SECTIONS[section];
    }
    return [
        PERSONA_SECTIONS[section],
        renderPanel(PERSONA_BASE_SUMMARY_TEMPLATE),
        renderPanel(PERSONA_ACTION_LOG_TEMPLATE),
    ].join(PERSONA_SECTION_SEPARATOR);
}

export function personaText(): string {
    return PERSONA_SECTION_ORDER.map((section) => sectionText(section)).join(PERSONA_SECTION_SEPARATOR);
}
