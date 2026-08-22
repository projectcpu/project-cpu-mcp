export enum PersonaSection {
    Role = 'role',
    Language = 'language',
    Anatomy = 'anatomy',
    Panels = 'panels',
    Templates = 'templates',
    Failures = 'failures',
    Rhythm = 'rhythm',
}

export interface PersonaDelivery {
    isServed(): boolean;
    markServed(): void;
}
