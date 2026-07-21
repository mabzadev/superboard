export interface AppEvent {
  id: string;
  name: string;
  type: string;
  created_at: string;
  properties?: Record<string, unknown>;
}
