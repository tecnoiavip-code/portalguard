export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      access_entries: {
        Row: {
          apartment: string
          auto_recognized: boolean | null
          company: string | null
          entry_time: string | null
          exit_time: string | null
          id: string
          notes: string | null
          photo_url: string | null
          purpose: string | null
          registered_by: string | null
          resident_id: string | null
          resident_name: string | null
          vehicle_color: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          visitor_document: string
          visitor_name: string
          visitor_type: string | null
        }
        Insert: {
          apartment: string
          auto_recognized?: boolean | null
          company?: string | null
          entry_time?: string | null
          exit_time?: string | null
          id?: string
          notes?: string | null
          photo_url?: string | null
          purpose?: string | null
          registered_by?: string | null
          resident_id?: string | null
          resident_name?: string | null
          vehicle_color?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          visitor_document: string
          visitor_name: string
          visitor_type?: string | null
        }
        Update: {
          apartment?: string
          auto_recognized?: boolean | null
          company?: string | null
          entry_time?: string | null
          exit_time?: string | null
          id?: string
          notes?: string | null
          photo_url?: string | null
          purpose?: string | null
          registered_by?: string | null
          resident_id?: string | null
          resident_name?: string | null
          vehicle_color?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          visitor_document?: string
          visitor_name?: string
          visitor_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_entries_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      controlid_config: {
        Row: {
          api_path: string | null
          created_at: string | null
          device_id: string | null
          device_ip: string
          device_name: string
          device_port: string | null
          id: string
          is_active: boolean | null
          last_sync: string | null
          updated_at: string | null
        }
        Insert: {
          api_path?: string | null
          created_at?: string | null
          device_id?: string | null
          device_ip: string
          device_name: string
          device_port?: string | null
          id?: string
          is_active?: boolean | null
          last_sync?: string | null
          updated_at?: string | null
        }
        Update: {
          api_path?: string | null
          created_at?: string | null
          device_id?: string | null
          device_ip?: string
          device_name?: string
          device_port?: string | null
          id?: string
          is_active?: boolean | null
          last_sync?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      controlid_logs: {
        Row: {
          device_id: string
          event_type: string
          id: string
          payload: Json
          processed: boolean | null
          received_at: string | null
        }
        Insert: {
          device_id: string
          event_type: string
          id?: string
          payload: Json
          processed?: boolean | null
          received_at?: string | null
        }
        Update: {
          device_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean | null
          received_at?: string | null
        }
        Relationships: []
      }
      devices: {
        Row: {
          created_at: string | null
          id: string
          last_sync: string | null
          location: string
          name: string
          serial_number: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          last_sync?: string | null
          location: string
          name: string
          serial_number?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          last_sync?: string | null
          location?: string
          name?: string
          serial_number?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: []
      }
      incidents: {
        Row: {
          created_at: string | null
          description: string
          id: string
          reported_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          status: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          reported_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          status?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          reported_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          status?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      mails: {
        Row: {
          delivered_at: string | null
          id: string
          notes: string | null
          package_type: string | null
          received_at: string | null
          registered_by: string | null
          resident_id: string
          sender: string
          status: string | null
          withdrawn_by: string | null
        }
        Insert: {
          delivered_at?: string | null
          id?: string
          notes?: string | null
          package_type?: string | null
          received_at?: string | null
          registered_by?: string | null
          resident_id: string
          sender: string
          status?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          delivered_at?: string | null
          id?: string
          notes?: string | null
          package_type?: string | null
          received_at?: string | null
          registered_by?: string | null
          resident_id?: string
          sender?: string
          status?: string | null
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mails_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          full_name: string
          id: string
        }
        Insert: {
          created_at?: string | null
          full_name: string
          id: string
        }
        Update: {
          created_at?: string | null
          full_name?: string
          id?: string
        }
        Relationships: []
      }
      realtime_events: {
        Row: {
          created_at: string | null
          description: string
          id: string
          priority: string
          related_id: string | null
          timestamp: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description: string
          id?: string
          priority: string
          related_id?: string | null
          timestamp?: string | null
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string
          id?: string
          priority?: string
          related_id?: string | null
          timestamp?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      residents: {
        Row: {
          apartment: string
          cpf: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          id: string
          name: string
          phone: string | null
          photo_url: string | null
          updated_at: string | null
          vehicle_color: string | null
          vehicle_model: string | null
          vehicle_plate: string | null
          vehicle_tag: string | null
        }
        Insert: {
          apartment: string
          cpf?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          photo_url?: string | null
          updated_at?: string | null
          vehicle_color?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_tag?: string | null
        }
        Update: {
          apartment?: string
          cpf?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          photo_url?: string | null
          updated_at?: string | null
          vehicle_color?: string | null
          vehicle_model?: string | null
          vehicle_plate?: string | null
          vehicle_tag?: string | null
        }
        Relationships: []
      }
      shifts: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          shift_end: string | null
          shift_start: string
          team_members: string[]
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          shift_end?: string | null
          shift_start: string
          team_members: string[]
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          shift_end?: string | null
          shift_start?: string
          team_members?: string[]
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          granted_at: string | null
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          color: string | null
          created_at: string | null
          id: string
          model: string | null
          plate: string
          resident_id: string
          tag: string | null
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          id?: string
          model?: string | null
          plate: string
          resident_id: string
          tag?: string | null
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          id?: string
          model?: string | null
          plate?: string
          resident_id?: string
          tag?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "residents"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "security_guard" | "receptionist"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "security_guard", "receptionist"],
    },
  },
} as const
