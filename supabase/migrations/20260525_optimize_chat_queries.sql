-- Função RPC para obter threads de chat com agregação
-- Retorna uma única query em vez de N+1
CREATE OR REPLACE FUNCTION get_chat_threads()
RETURNS TABLE (
  resident_id uuid,
  resident_name text,
  apartment text,
  unread_count bigint,
  last_message text,
  last_time timestamp with time zone
) AS $$
SELECT 
  r.id as resident_id,
  r.name as resident_name,
  r.apartment as apartment,
  COUNT(CASE WHEN cm.sender_type = 'resident' AND cm.read = false THEN 1 END) as unread_count,
  (SELECT message FROM chat_messages WHERE resident_id = r.id ORDER BY created_at DESC LIMIT 1) as last_message,
  (SELECT created_at FROM chat_messages WHERE resident_id = r.id ORDER BY created_at DESC LIMIT 1) as last_time
FROM residents r
INNER JOIN chat_messages cm ON r.id = cm.resident_id
GROUP BY r.id, r.name, r.apartment
ORDER BY MAX(cm.created_at) DESC;
$$ LANGUAGE SQL STABLE;

-- Índices para otimizar queries frequentes
CREATE INDEX IF NOT EXISTS idx_chat_messages_resident_id ON chat_messages(resident_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_resident_read ON chat_messages(resident_id, read, sender_type);
CREATE INDEX IF NOT EXISTS idx_residents_email_lower ON residents(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_access_entries_apartment ON access_entries(apartment);
CREATE INDEX IF NOT EXISTS idx_access_entries_visitor_doc ON access_entries(visitor_document);
CREATE INDEX IF NOT EXISTS idx_blocked_visitors_doc ON blocked_visitors(visitor_document);
CREATE INDEX IF NOT EXISTS idx_push_command_results_id ON push_command_results(id);
CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial_number);

-- Performance: índices para buscas de sugestões
CREATE INDEX IF NOT EXISTS idx_access_vehicle_model ON access_entries(vehicle_model) WHERE vehicle_model IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_vehicle_color ON access_entries(vehicle_color) WHERE vehicle_color IS NOT NULL;

-- Comentários para documentação
COMMENT ON FUNCTION get_chat_threads() IS 'Retorna todos os threads de chat com dados agregados em UMA ÚNICA query (otimização N+1)';
