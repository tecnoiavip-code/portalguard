-- =====================================================================
-- PortalGuard - limpeza de fotos em base64 ja gravadas no banco (legado)
-- ---------------------------------------------------------------------
-- Rode no SQL Editor do Supabase, BLOCO A BLOCO, vendo o resultado de
-- cada um antes de seguir. A tabela de backup e criada antes de qualquer
-- UPDATE e permite desfazer.
--
-- Vale para:
--   * public.controlid_logs      (payload JSONB com foto do dispositivo)
--   * public.push_command_queue  (result JSONB com resultado de comando)
--
-- NAO vale para public.access_entries.photo_url: la a foto precisa ser
-- SUBIDA pro Storage (nao da pra fazer em SQL) -> use no app
-- Configuracoes > "Otimizar fotos das entradas".
-- =====================================================================

-- ------------------------------- BLOCO 0: diagnostico ----------------
SELECT 'controlid_logs' AS tabela,
       count(*) AS linhas_grandes,
       pg_size_pretty(coalesce(sum(length(payload::text)), 0)::bigint) AS tamanho
FROM public.controlid_logs
WHERE length(payload::text) > 5000
UNION ALL
SELECT 'push_command_queue',
       count(*),
       pg_size_pretty(coalesce(sum(length(result::text)), 0)::bigint)
FROM public.push_command_queue
WHERE result IS NOT NULL AND length(result::text) > 5000;

-- Quantas linhas ja tem a foto guardada no Storage (seguras de limpar)
SELECT count(*) AS linhas_com_foto_no_storage
FROM public.controlid_logs
WHERE payload ? 'saved_photo_path' AND length(payload::text) > 5000;

-- ------------------------------- BLOCO 1: backup ---------------------
CREATE TABLE IF NOT EXISTS public.backup_controlid_logs_fotos AS
SELECT id, received_at, payload
FROM public.controlid_logs
WHERE length(payload::text) > 5000;

CREATE TABLE IF NOT EXISTS public.backup_push_command_queue_result AS
SELECT id, result
FROM public.push_command_queue
WHERE result IS NOT NULL AND length(result::text) > 5000;

-- ------------------------------- BLOCO 2: controlid_logs -------------
-- 2a) Fotos no topo do payload das linhas que JA tem a foto no Storage
--     (saved_photo_path): aqui nada se perde.
UPDATE public.controlid_logs
SET payload = (
        CASE
          WHEN payload->>'response' ~ '^\s*\{'
          THEN jsonb_set(
                 payload,
                 '{response}',
                 (payload->>'response')::jsonb - 'photo' - 'image' - 'user_image' - 'access_photo'
               )
          ELSE payload
        END
      )
      - 'photo' - 'image' - 'photo_data' - 'face_image'
      - 'user_image_data' - 'user_image_hash' - 'user_image' - 'access_photo'
WHERE payload ? 'saved_photo_path'
  AND length(payload::text) > 5000;

-- 2b) Fotos guardadas dentro das strings JSON "raw_data" e do objeto
--     "result" (tipicamente respostas de comando / eventos push_result).
--     O webhook salva essa mesma foto no Storage na hora, mas o marcador
--     saved_photo_path fica em OUTRA linha (o log original), por isso aqui
--     nao da pra filtrar. Se algum upload tiver falhado, a imagem antiga
--     deixa de aparecer no Dashboard; o BLOCO 1 desfaz.
UPDATE public.controlid_logs
SET payload = CASE
        WHEN payload->>'raw_data' ~ '^\s*\{'
        THEN jsonb_set(
               payload,
               '{raw_data}',
               (payload->>'raw_data')::jsonb - 'photo' - 'image' - 'user_image' - 'access_photo'
             )
        ELSE payload
      END
WHERE payload->>'raw_data' ~ '^\s*\{'
  AND length(payload::text) > 5000;

UPDATE public.controlid_logs
SET payload = CASE
        WHEN jsonb_typeof(payload->'result') = 'object'
        THEN payload #- '{result,photo}' #- '{result,image}'
                    #- '{result,user_image}' #- '{result,access_photo}'
        ELSE payload
      END
WHERE jsonb_typeof(payload->'result') = 'object'
  AND length(payload::text) > 5000;

-- ------------------------ BLOCO 2b: opcional -------------------------
-- Linhas SEM saved_photo_path: a foto so existe dentro do JSON (o upload
-- pro Storage falhou na epoca). Descomente se aceitar que essas imagens
-- deixem de aparecer no Dashboard.
/*
UPDATE public.controlid_logs
SET payload = (
        CASE
          WHEN payload->>'response' ~ '^\s*\{'
          THEN jsonb_set(
                 payload,
                 '{response}',
                 (payload->>'response')::jsonb - 'photo' - 'image' - 'user_image' - 'access_photo'
               )
          ELSE payload
        END
      )
      - 'photo' - 'image' - 'photo_data' - 'face_image'
      - 'user_image_data' - 'user_image_hash' - 'user_image' - 'access_photo'
WHERE NOT (payload ? 'saved_photo_path')
  AND length(payload::text) > 5000;
*/

-- ------------------------------- BLOCO 3: push_command_queue ----------
-- Resultado de comandos (ex.: user_get_image) tambem guarda a foto em
-- base64. O webhook ja grava essa mesma foto no Storage, mas esta tabela
-- nao tem marcador; descomente se quiser liberar esse espaco tambem.
/*
UPDATE public.push_command_queue
SET result = result - 'photo' - 'image' - 'photo_data' - 'face_image'
                  - 'user_image_data' - 'user_image_hash' - 'user_image' - 'access_photo'
WHERE result IS NOT NULL
  AND length(result::text) > 5000;
*/

-- ------------------------------- BLOCO 4: verificacao -----------------
SELECT 'controlid_logs' AS tabela,
       count(*) AS linhas_grandes,
       pg_size_pretty(coalesce(sum(length(payload::text)), 0)::bigint) AS tamanho
FROM public.controlid_logs
WHERE length(payload::text) > 5000
UNION ALL
SELECT 'push_command_queue',
       count(*),
       pg_size_pretty(coalesce(sum(length(result::text)), 0)::bigint)
FROM public.push_command_queue
WHERE result IS NOT NULL AND length(result::text) > 5000;

-- ------------------------------- DESFAZER -----------------------------
/*
UPDATE public.controlid_logs l
SET payload = b.payload
FROM public.backup_controlid_logs_fotos b
WHERE l.id = b.id;

UPDATE public.push_command_queue q
SET result = b.result
FROM public.backup_push_command_queue_result b
WHERE q.id = b.id;
*/
