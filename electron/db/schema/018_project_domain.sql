-- v1.4.7 为 projects 表新增 domain 字段（本地服务 / SaaS / 电商）
ALTER TABLE projects ADD COLUMN domain TEXT CHECK(domain IN ('local_service', 'saas', 'ecommerce')) DEFAULT NULL;
