-- Apagar uma campanha deixava suas ações órfãs (campaign_id ON DELETE SET NULL),
-- e elas continuavam bloqueando o comentário como "já na fila" para sempre.
-- Uma ação de campanha não existe sem a campanha: passa a CASCADE.
alter table comment_actions drop constraint comment_actions_campaign_fk;
alter table comment_actions add constraint comment_actions_campaign_fk
  foreign key (campaign_id) references dm_campaigns(id) on delete cascade;
