export type WidgetType = "weather" | "clock" | "rss";
export type Breakpoint = "lg" | "md" | "sm";

export interface User { id: number; email: string; password_hash: string | null; created_at: string }
export interface Identity { id: number; user_id: number; provider: string; provider_subject: string }
export interface Session { id_hash: string; user_id: number; expires_at: string; created_at: string }
export interface Widget { id: number; user_id: number; type: WidgetType; config_json: string; created_at: string }
export interface Layout { user_id: number; breakpoint: Breakpoint; widget_order_json: string }
export interface RssCacheEntry { feed_url: string; fetched_at: string; etag: string | null; items_json: string }
