CREATE TABLE IF NOT EXISTS dataset_state (
  id TINYINT UNSIGNED NOT NULL,
  dataset_epoch CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('RESETTING', 'READY') NOT NULL DEFAULT 'RESETTING',
  seeded_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dataset_state_epoch (dataset_epoch),
  CONSTRAINT chk_dataset_state_singleton CHECK (id = 1)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS employees (
  emp_no VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  emp_name VARCHAR(120) NOT NULL,
  dept_name VARCHAR(120) NOT NULL,
  position_name VARCHAR(80) NOT NULL,
  hire_date DATE NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (emp_no),
  KEY idx_employees_dept_active (dept_name, is_active, emp_no),
  KEY idx_employees_active_hire (is_active, hire_date, emp_no),
  CONSTRAINT chk_employees_active CHECK (is_active IN (0, 1))
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS business_areas (
  area_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  area_name VARCHAR(160) NOT NULL,
  parent_area_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  manager_emp_no VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  registered_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (area_id),
  UNIQUE KEY uq_business_areas_manager_pair (area_id, manager_emp_no),
  KEY idx_business_areas_parent (parent_area_id, area_id),
  KEY idx_business_areas_manager (manager_emp_no, area_id),
  KEY idx_business_areas_name (area_name, area_id),
  CONSTRAINT fk_business_areas_parent FOREIGN KEY (parent_area_id)
    REFERENCES business_areas (area_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_business_areas_manager FOREIGN KEY (manager_emp_no)
    REFERENCES employees (emp_no) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- The next two tables deliberately preserve the source CSV shapes. They let
-- students compare a normalized join with the provided lookup/snapshot files.
CREATE TABLE IF NOT EXISTS business_area_parent_lookup (
  area_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  area_name VARCHAR(160) NOT NULL,
  area_level VARCHAR(40) NOT NULL,
  registered_at DATETIME(3) NOT NULL,
  PRIMARY KEY (area_id),
  KEY idx_parent_lookup_level (area_level, area_id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS business_area_join_ready (
  area_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  area_name VARCHAR(160) NOT NULL,
  parent_area_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NULL,
  parent_area_name VARCHAR(160) NULL,
  manager_emp_no VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  manager_emp_name VARCHAR(120) NOT NULL,
  manager_dept_name VARCHAR(120) NOT NULL,
  manager_position_name VARCHAR(80) NOT NULL,
  registered_at DATETIME(3) NOT NULL,
  PRIMARY KEY (area_id),
  KEY idx_join_ready_parent (parent_area_id, area_id),
  KEY idx_join_ready_manager (manager_emp_no, area_id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS locations (
  id SMALLINT UNSIGNED NOT NULL,
  province VARCHAR(80) NOT NULL,
  city VARCHAR(80) NOT NULL,
  slug VARCHAR(100) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_locations_slug (slug),
  KEY idx_locations_province_city (province, city, id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS vehicle_brands (
  id SMALLINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(80) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  country VARCHAR(80) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_brands_slug (slug),
  KEY idx_vehicle_brands_name (name)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS vehicle_models (
  id SMALLINT UNSIGNED NOT NULL,
  brand_id SMALLINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  body_type VARCHAR(40) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_models_brand_slug (brand_id, slug),
  KEY idx_vehicle_models_brand_name (brand_id, name, id),
  CONSTRAINT fk_vehicle_models_brand FOREIGN KEY (brand_id)
    REFERENCES vehicle_brands (id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS vehicle_listings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_number VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  model_id SMALLINT UNSIGNED NOT NULL,
  location_id SMALLINT UNSIGNED NOT NULL,
  dealer_emp_no VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  business_area_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  title VARCHAR(220) NOT NULL,
  trim_name VARCHAR(120) NOT NULL,
  model_year SMALLINT UNSIGNED NOT NULL,
  first_registration DATE NOT NULL,
  mileage_km INT UNSIGNED NOT NULL,
  fuel_type VARCHAR(32) NOT NULL,
  transmission VARCHAR(32) NOT NULL,
  price BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'KRW',
  color VARCHAR(40) NOT NULL,
  displacement_cc SMALLINT UNSIGNED NOT NULL,
  accident_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  owner_change_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  inspection_status VARCHAR(32) NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'AVAILABLE',
  description TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_vehicle_listings_number (listing_number),
  KEY idx_vehicle_listings_model_created (model_id, created_at DESC, id DESC),
  KEY idx_vehicle_listings_location_created (location_id, created_at DESC, id DESC),
  KEY idx_vehicle_listings_area (business_area_id, id),
  KEY idx_vehicle_listings_dealer (dealer_emp_no, id),
  KEY idx_vehicle_listings_area_dealer (business_area_id, dealer_emp_no),
  KEY idx_vehicle_listings_status_created (status, created_at DESC, id DESC),
  KEY idx_vehicle_listings_price (price, id),
  KEY idx_vehicle_listings_year_mileage (model_year DESC, mileage_km, id),
  KEY idx_vehicle_listings_cursor (id),
  FULLTEXT KEY idx_vehicle_listings_search (title, description) WITH PARSER ngram,
  CONSTRAINT fk_vehicle_listings_model FOREIGN KEY (model_id)
    REFERENCES vehicle_models (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_listings_location FOREIGN KEY (location_id)
    REFERENCES locations (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_listings_dealer FOREIGN KEY (dealer_emp_no)
    REFERENCES employees (emp_no) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_listings_area FOREIGN KEY (business_area_id)
    REFERENCES business_areas (area_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_listings_area_manager FOREIGN KEY (business_area_id, dealer_emp_no)
    REFERENCES business_areas (area_id, manager_emp_no) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_vehicle_listings_year CHECK (model_year BETWEEN 1990 AND 2030),
  CONSTRAINT chk_vehicle_listings_status CHECK (status IN ('AVAILABLE', 'RESERVED', 'SOLD')),
  CONSTRAINT chk_vehicle_listings_price CHECK (price > 0)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  key_prefix VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  key_hash BINARY(32) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_used_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_keys_prefix (key_prefix),
  UNIQUE KEY uq_api_keys_hash (key_hash),
  KEY idx_api_keys_active (revoked_at, id)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Synthetic data generation is deliberately recorded separately from HTTP
-- access logs.  Students can crawl these bounded, non-secret run summaries
-- without creating a recursive "reading a log writes another source log"
-- loop.
CREATE TABLE IF NOT EXISTS generation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_key VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  requested_count INT UNSIGNED NOT NULL,
  sequence_start BIGINT UNSIGNED NOT NULL,
  sequence_end BIGINT UNSIGNED NOT NULL,
  mysql_count INT UNSIGNED NOT NULL DEFAULT 0,
  mongo_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_generation_runs_key (run_key),
  KEY idx_generation_runs_status_started (status, started_at DESC, id DESC),
  KEY idx_generation_runs_cursor (id),
  CONSTRAINT chk_generation_runs_status CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED')),
  CONSTRAINT chk_generation_runs_range CHECK (sequence_end >= sequence_start)
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- Append-only status transitions for generation runs.  generation_runs is the
-- mutable current-state projection; crawlers must advance through this table's
-- event_id so RUNNING -> terminal and retry transitions cannot be missed.
CREATE TABLE IF NOT EXISTS generation_run_events (
  event_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  mysql_count INT UNSIGNED NOT NULL DEFAULT 0,
  mongo_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  PRIMARY KEY (event_id),
  KEY idx_generation_run_events_run (run_id, event_id),
  KEY idx_generation_run_events_status_time (status, occurred_at, event_id),
  CONSTRAINT fk_generation_run_events_run FOREIGN KEY (run_id)
    REFERENCES generation_runs (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_generation_run_events_status CHECK (status IN ('RUNNING', 'SUCCESS', 'PARTIAL_FAILED', 'FAILED'))
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

-- One append-only event per generated listing.  payload_json is the public
-- document shape, not an employee/credential-bearing internal row.
CREATE TABLE IF NOT EXISTS listing_change_log (
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_id BIGINT UNSIGNED NOT NULL,
  operation VARCHAR(16) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL DEFAULT 'UPSERT',
  listing_id BIGINT UNSIGNED NOT NULL,
  listing_number VARCHAR(32) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  entity_version INT UNSIGNED NOT NULL DEFAULT 1,
  occurred_at DATETIME(3) NOT NULL,
  payload_json JSON NOT NULL,
  source_checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (seq),
  UNIQUE KEY uq_listing_change_log_event (event_id),
  UNIQUE KEY uq_listing_change_log_listing_version (listing_number, entity_version),
  KEY idx_listing_change_log_run_seq (run_id, seq),
  KEY idx_listing_change_log_occurred_seq (occurred_at, seq),
  KEY idx_listing_change_log_cursor (seq),
  CONSTRAINT fk_listing_change_log_run FOREIGN KEY (run_id)
    REFERENCES generation_runs (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_listing_change_log_operation CHECK (operation IN ('UPSERT', 'DELETE'))
) ENGINE = InnoDB DEFAULT CHARACTER SET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

CREATE OR REPLACE VIEW v_business_area_normalized_join AS
SELECT
  a.area_id,
  a.area_name,
  a.parent_area_id,
  p.area_name AS parent_area_name,
  a.manager_emp_no,
  e.emp_name AS manager_emp_name,
  e.dept_name AS manager_dept_name,
  e.position_name AS manager_position_name,
  a.registered_at
FROM business_areas a
LEFT JOIN business_areas p ON p.area_id = a.parent_area_id
INNER JOIN employees e ON e.emp_no = a.manager_emp_no;
