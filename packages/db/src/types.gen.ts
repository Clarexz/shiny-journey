export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      agent_config_history: {
        Row: {
          agent_config_id: string;
          changed_by: string | null;
          config: NonNullable<Json>;
          config_version: number;
          created_at: string;
          id: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          agent_config_id: string;
          changed_by?: string | null;
          config: NonNullable<Json>;
          config_version: number;
          created_at?: string;
          id?: string;
          tenant_id: string;
        };
        Update: {
          agent_config_id?: string;
          changed_by?: string | null;
          config?: NonNullable<Json>;
          config_version?: number;
          created_at?: string;
          id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_config_history_agent_config_fk";
            columns: ["agent_config_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_configs";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agent_config_history_changed_by_fkey";
            columns: ["changed_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_configs: {
        Row: {
          channel_id: string;
          config: NonNullable<Json>;
          config_version: number;
          created_at: string;
          id: string;
          module_key: string;
          name: string;
          schema_version: string;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          channel_id: string;
          config: NonNullable<Json>;
          config_version?: number;
          created_at?: string;
          id?: string;
          module_key: string;
          name: string;
          schema_version: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          config?: NonNullable<Json>;
          config_version?: number;
          created_at?: string;
          id?: string;
          module_key?: string;
          name?: string;
          schema_version?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_configs_channel_fk";
            columns: ["channel_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agent_configs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      agent_events: {
        Row: {
          agent_config_id: string;
          captured_message_id: string | null;
          created_at: string;
          decision: string | null;
          extraction: Json | null;
          feedback: string | null;
          feedback_at: string | null;
          id: string;
          kind: string;
          latency: Json | null;
          llm: Json | null;
          reasons: string[];
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          agent_config_id: string;
          captured_message_id?: string | null;
          created_at?: string;
          decision?: string | null;
          extraction?: Json | null;
          feedback?: string | null;
          feedback_at?: string | null;
          id?: string;
          kind: string;
          latency?: Json | null;
          llm?: Json | null;
          reasons?: string[];
          tenant_id: string;
        };
        Update: {
          agent_config_id?: string;
          captured_message_id?: string | null;
          created_at?: string;
          decision?: string | null;
          extraction?: Json | null;
          feedback?: string | null;
          feedback_at?: string | null;
          id?: string;
          kind?: string;
          latency?: Json | null;
          llm?: Json | null;
          reasons?: string[];
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_events_agent_config_fk";
            columns: ["agent_config_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_configs";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "agent_events_captured_message_fk";
            columns: ["captured_message_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "captured_messages";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor_user_id: string | null;
          created_at: string;
          data: NonNullable<Json>;
          id: string;
          target: string | null;
          tenant_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_user_id?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          target?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          created_at?: string;
          data?: NonNullable<Json>;
          id?: string;
          target?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_user_id_fkey";
            columns: ["actor_user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      captured_messages: {
        Row: {
          agent_config_id: string;
          channel_id: string;
          chat_jid: string;
          created_at: string;
          external_id: string;
          id: string;
          received_at: string;
          sender_jid: string;
          sender_name: string | null;
          sender_phone: string | null;
          tenant_id: string;
          text: string | null;
          text_purged_at: string | null;
          wa_timestamp: string;
        };
        ComputedFields: never;
        Insert: {
          agent_config_id: string;
          channel_id: string;
          chat_jid: string;
          created_at?: string;
          external_id: string;
          id?: string;
          received_at: string;
          sender_jid: string;
          sender_name?: string | null;
          sender_phone?: string | null;
          tenant_id: string;
          text?: string | null;
          text_purged_at?: string | null;
          wa_timestamp: string;
        };
        Update: {
          agent_config_id?: string;
          channel_id?: string;
          chat_jid?: string;
          created_at?: string;
          external_id?: string;
          id?: string;
          received_at?: string;
          sender_jid?: string;
          sender_name?: string | null;
          sender_phone?: string | null;
          tenant_id?: string;
          text?: string | null;
          text_purged_at?: string | null;
          wa_timestamp?: string;
        };
        Relationships: [
          {
            foreignKeyName: "captured_messages_agent_config_fk";
            columns: ["agent_config_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_configs";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "captured_messages_channel_fk";
            columns: ["channel_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      channel_status_events: {
        Row: {
          channel_id: string;
          created_at: string;
          detail: NonNullable<Json>;
          id: string;
          status: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          channel_id: string;
          created_at?: string;
          detail?: NonNullable<Json>;
          id?: string;
          status: string;
          tenant_id: string;
        };
        Update: {
          channel_id?: string;
          created_at?: string;
          detail?: NonNullable<Json>;
          id?: string;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channel_status_events_channel_fk";
            columns: ["channel_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      channels: {
        Row: {
          created_at: string;
          external_instance: string;
          id: string;
          last_inbound_at: string | null;
          phone: string | null;
          provider: string;
          settings: NonNullable<Json>;
          status: string;
          status_changed_at: string;
          tenant_id: string;
          webhook_token_hash: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          external_instance: string;
          id?: string;
          last_inbound_at?: string | null;
          phone?: string | null;
          provider: string;
          settings?: NonNullable<Json>;
          status?: string;
          status_changed_at?: string;
          tenant_id: string;
          webhook_token_hash: string;
        };
        Update: {
          created_at?: string;
          external_instance?: string;
          id?: string;
          last_inbound_at?: string | null;
          phone?: string | null;
          provider?: string;
          settings?: NonNullable<Json>;
          status?: string;
          status_changed_at?: string;
          tenant_id?: string;
          webhook_token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channels_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      inbound_dedupe: {
        Row: {
          channel_id: string;
          external_id: string;
          received_at: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          channel_id: string;
          external_id: string;
          received_at?: string;
          tenant_id: string;
        };
        Update: {
          channel_id?: string;
          external_id?: string;
          received_at?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inbound_dedupe_channel_fk";
            columns: ["channel_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      mod_turnos_availability: {
        Row: {
          agent_config_id: string;
          available: boolean;
          date: string;
          note: string | null;
          tenant_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          agent_config_id: string;
          available: boolean;
          date: string;
          note?: string | null;
          tenant_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          agent_config_id?: string;
          available?: boolean;
          date?: string;
          note?: string | null;
          tenant_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mod_turnos_availability_agent_config_fk";
            columns: ["agent_config_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_configs";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "mod_turnos_availability_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      mod_turnos_branches: {
        Row: {
          active: boolean;
          address: string;
          city: string;
          code: string;
          colonia: string;
          cp: string | null;
          created_at: string;
          keywords: string[];
          number: number;
          official_name: string;
          series: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          address: string;
          city: string;
          code: string;
          colonia: string;
          cp?: string | null;
          created_at?: string;
          keywords?: string[];
          number: number;
          official_name: string;
          series: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          address?: string;
          city?: string;
          code?: string;
          colonia?: string;
          cp?: string | null;
          created_at?: string;
          keywords?: string[];
          number?: number;
          official_name?: string;
          series?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      mod_turnos_claims: {
        Row: {
          agent_config_id: string;
          agent_event_id: string | null;
          branch_code: string | null;
          branch_number: number;
          created_at: string;
          date: string;
          id: string;
          origin: string;
          publisher_jid: string;
          shift: string;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          agent_config_id: string;
          agent_event_id?: string | null;
          branch_code?: string | null;
          branch_number: number;
          created_at?: string;
          date: string;
          id?: string;
          origin: string;
          publisher_jid: string;
          shift: string;
          status?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          agent_config_id?: string;
          agent_event_id?: string | null;
          branch_code?: string | null;
          branch_number?: number;
          created_at?: string;
          date?: string;
          id?: string;
          origin?: string;
          publisher_jid?: string;
          shift?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mod_turnos_claims_agent_config_fk";
            columns: ["agent_config_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_configs";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "mod_turnos_claims_agent_event_fk";
            columns: ["agent_event_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_events";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "mod_turnos_claims_branch_code_fkey";
            columns: ["branch_code"];
            isOneToOne: false;
            referencedRelation: "mod_turnos_branches";
            referencedColumns: ["code"];
          },
        ];
      };
      notifications: {
        Row: {
          acted_at: string | null;
          action_expires_at: string | null;
          action_token_hash: string | null;
          body: string;
          channels_tried: string[];
          created_at: string;
          id: string;
          kind: string;
          payload: NonNullable<Json>;
          priority: string;
          read_at: string | null;
          sent_at: string | null;
          status: string;
          tenant_id: string;
          title: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          acted_at?: string | null;
          action_expires_at?: string | null;
          action_token_hash?: string | null;
          body: string;
          channels_tried?: string[];
          created_at?: string;
          id?: string;
          kind: string;
          payload?: NonNullable<Json>;
          priority: string;
          read_at?: string | null;
          sent_at?: string | null;
          status?: string;
          tenant_id: string;
          title: string;
          user_id?: string | null;
        };
        Update: {
          acted_at?: string | null;
          action_expires_at?: string | null;
          action_token_hash?: string | null;
          body?: string;
          channels_tried?: string[];
          created_at?: string;
          id?: string;
          kind?: string;
          payload?: NonNullable<Json>;
          priority?: string;
          read_at?: string | null;
          sent_at?: string | null;
          status?: string;
          tenant_id?: string;
          title?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_fk";
            columns: ["user_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      outbound_messages: {
        Row: {
          agent_event_id: string | null;
          body: string;
          channel_id: string;
          created_at: string;
          error: string | null;
          id: string;
          idempotency_key: string;
          origin: string;
          provider_message_id: string | null;
          sent_at: string | null;
          status: string;
          template_id: string;
          tenant_id: string;
          to_jid: string;
        };
        ComputedFields: never;
        Insert: {
          agent_event_id?: string | null;
          body: string;
          channel_id: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          idempotency_key: string;
          origin: string;
          provider_message_id?: string | null;
          sent_at?: string | null;
          status?: string;
          template_id: string;
          tenant_id: string;
          to_jid: string;
        };
        Update: {
          agent_event_id?: string | null;
          body?: string;
          channel_id?: string;
          created_at?: string;
          error?: string | null;
          id?: string;
          idempotency_key?: string;
          origin?: string;
          provider_message_id?: string | null;
          sent_at?: string | null;
          status?: string;
          template_id?: string;
          tenant_id?: string;
          to_jid?: string;
        };
        Relationships: [
          {
            foreignKeyName: "outbound_messages_agent_event_fk";
            columns: ["agent_event_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "agent_events";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "outbound_messages_channel_fk";
            columns: ["channel_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_success_at: string | null;
          p256dh: string;
          tenant_id: string;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_success_at?: string | null;
          p256dh: string;
          tenant_id: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_success_at?: string | null;
          p256dh?: string;
          tenant_id?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_fk";
            columns: ["user_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      tenants: {
        Row: {
          config: NonNullable<Json>;
          created_at: string;
          id: string;
          modules_enabled: string[];
          name: string;
          slug: string;
          status: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          config?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          modules_enabled?: string[];
          name: string;
          slug: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          config?: NonNullable<Json>;
          created_at?: string;
          id?: string;
          modules_enabled?: string[];
          name?: string;
          slug?: string;
          status?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          role: string;
          tenant_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          full_name: string;
          id: string;
          role: string;
          tenant_id?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          role?: string;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "users_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      wa_lid_map: {
        Row: {
          channel_id: string;
          lid: string;
          phone: string | null;
          source: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          channel_id: string;
          lid: string;
          phone?: string | null;
          source: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          channel_id?: string;
          lid?: string;
          phone?: string | null;
          source?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wa_lid_map_channel_fk";
            columns: ["channel_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
