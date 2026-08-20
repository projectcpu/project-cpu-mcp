export interface PanelField {
    label: string;
    value: string | null;
}

export type PanelRow = Array<PanelField>;

export interface PanelSpec {
    title: string;
    rows: Array<PanelRow>;
}
