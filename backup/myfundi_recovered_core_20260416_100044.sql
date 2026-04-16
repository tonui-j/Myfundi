-- MariaDB dump 10.19  Distrib 10.4.32-MariaDB, for Win64 (AMD64)
--
-- Host: localhost    Database: myfundi
-- ------------------------------------------------------
-- Server version	10.4.32-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `audit_logs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `admin_id` bigint(20) unsigned NOT NULL,
  `action` varchar(100) NOT NULL,
  `target_type` varchar(50) DEFAULT NULL,
  `target_id` bigint(20) unsigned DEFAULT NULL,
  `detail` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_admin_id` (`admin_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,1,'worker.verify','worker',3,'Worker verified','2026-03-18 20:08:14'),(2,1,'worker.verify','worker',5,'Worker verified','2026-04-16 01:58:33');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bookings`
--

DROP TABLE IF EXISTS `bookings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `bookings` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `worker_id` bigint(20) unsigned NOT NULL,
  `client_id` bigint(20) unsigned DEFAULT NULL,
  `booking_date` date NOT NULL,
  `booking_time` time NOT NULL,
  `client_name` varchar(120) NOT NULL,
  `client_phone` varchar(50) NOT NULL,
  `description` text NOT NULL,
  `status` enum('pending','approved','declined') NOT NULL DEFAULT 'pending',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `client_email` varchar(160) DEFAULT NULL,
  `service_address` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bookings_worker_id` (`worker_id`),
  KEY `idx_bookings_status` (`status`),
  KEY `idx_bookings_client_id` (`client_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bookings`
--

LOCK TABLES `bookings` WRITE;
/*!40000 ALTER TABLE `bookings` DISABLE KEYS */;
INSERT INTO `bookings` VALUES (1,3,2,'2026-04-01','10:00:00','pierrairis','0721345678','fix lights','','2026-03-18 02:23:48',NULL,NULL),(2,1,2,'2026-12-04','11:00:00','pierra','0712345678','fix water pipes','declined','2026-03-18 20:48:26',NULL,NULL),(3,5,2,'2026-12-04','11:00:00','pierra','0712345678','fix water pipes','','2026-03-18 20:52:44',NULL,NULL),(4,1,2,'2026-04-19','11:00:00','pierra iris','0742372683','fix the tank pipes','pending','2026-04-16 01:44:25','pierrairis@gmail.com','53067-00200');
/*!40000 ALTER TABLE `bookings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `clients`
--

DROP TABLE IF EXISTS `clients`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `clients` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(80) NOT NULL,
  `display_name` varchar(120) NOT NULL,
  `email` varchar(160) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `profile_image` varchar(255) DEFAULT NULL,
  `role` enum('admin','customer') NOT NULL DEFAULT 'customer',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `idx_clients_username` (`username`),
  UNIQUE KEY `idx_clients_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `clients`
--

LOCK TABLES `clients` WRITE;
/*!40000 ALTER TABLE `clients` DISABLE KEYS */;
INSERT INTO `clients` VALUES (1,'admin','Administrator','admin@bluecollar.local','$2a$10$zE4eMP1Ig4uNkixrIuqVGuF5rwrWDbHv.4T/hzdIRDERmFJ.JXC9G',NULL,'admin','2026-03-16 00:48:50'),(2,'pierra','pierrairis','pierrairis@gmail.com','$2a$10$S8E9a1CwLikvm/mt1fggdOCsw0fE23ZiGXdMEPnGhCnx5g3pqMkRy',NULL,'customer','2026-03-18 00:39:49');
/*!40000 ALTER TABLE `clients` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `disputes`
--

DROP TABLE IF EXISTS `disputes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `disputes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `booking_id` bigint(20) unsigned DEFAULT NULL,
  `raised_by_client_id` bigint(20) unsigned DEFAULT NULL,
  `against_worker_id` bigint(20) unsigned NOT NULL,
  `description` text NOT NULL,
  `status` enum('open','reviewing','resolved') NOT NULL DEFAULT 'open',
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_disputes_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `disputes`
--

LOCK TABLES `disputes` WRITE;
/*!40000 ALTER TABLE `disputes` DISABLE KEYS */;
/*!40000 ALTER TABLE `disputes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `password_reset_tokens`
--

DROP TABLE IF EXISTS `password_reset_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `password_reset_tokens` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `client_id` bigint(20) unsigned NOT NULL,
  `token` varchar(255) NOT NULL,
  `expires_at` datetime NOT NULL,
  `used` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `idx_reset_tokens_token` (`token`),
  KEY `idx_reset_tokens_client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `password_reset_tokens`
--

LOCK TABLES `password_reset_tokens` WRITE;
/*!40000 ALTER TABLE `password_reset_tokens` DISABLE KEYS */;
/*!40000 ALTER TABLE `password_reset_tokens` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `permissions`
--

DROP TABLE IF EXISTS `permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `permissions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(100) NOT NULL,
  `description` varchar(255) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=107 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `permissions`
--

LOCK TABLES `permissions` WRITE;
/*!40000 ALTER TABLE `permissions` DISABLE KEYS */;
INSERT INTO `permissions` VALUES (1,'auth.register','Create an account','2026-03-16 00:48:50'),(2,'auth.login','Log into the system','2026-03-16 00:48:50'),(3,'profile.view.self','View own profile','2026-03-16 00:48:50'),(4,'booking.create','Create a booking request','2026-03-16 00:48:50'),(5,'worker.profile.create.self','Create worker profile during registration','2026-03-16 00:48:50'),(6,'admin.dashboard.view','View admin dashboard','2026-03-16 00:48:50'),(7,'admin.worker.verify','Verify worker accounts','2026-03-16 00:48:50'),(8,'admin.booking.view','View all bookings','2026-03-16 00:48:50');
/*!40000 ALTER TABLE `permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `role_permissions`
--

DROP TABLE IF EXISTS `role_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `role_permissions` (
  `role_id` int(10) unsigned NOT NULL,
  `permission_id` int(10) unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`role_id`,`permission_id`),
  KEY `fk_role_permissions_permission` (`permission_id`),
  CONSTRAINT `fk_role_permissions_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_role_permissions_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `role_permissions`
--

LOCK TABLES `role_permissions` WRITE;
/*!40000 ALTER TABLE `role_permissions` DISABLE KEYS */;
INSERT INTO `role_permissions` VALUES (1,1,'2026-03-16 00:48:50'),(1,2,'2026-03-16 00:48:50'),(1,3,'2026-03-16 00:48:50'),(1,6,'2026-03-16 00:48:50'),(1,7,'2026-03-16 00:48:50'),(1,8,'2026-03-16 00:48:50'),(2,1,'2026-03-16 00:48:50'),(2,2,'2026-03-16 00:48:50'),(2,3,'2026-03-16 00:48:50'),(2,4,'2026-03-16 00:48:50'),(3,1,'2026-03-16 00:48:50'),(3,2,'2026-03-16 00:48:50'),(3,3,'2026-03-16 00:48:50'),(3,5,'2026-03-16 00:48:50');
/*!40000 ALTER TABLE `role_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `roles`
--

DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `roles` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(50) NOT NULL,
  `name` varchar(80) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `roles`
--

LOCK TABLES `roles` WRITE;
/*!40000 ALTER TABLE `roles` DISABLE KEYS */;
INSERT INTO `roles` VALUES (1,'admin','Administrator','2026-03-16 00:48:50'),(2,'customer','Customer','2026-03-16 00:48:50'),(3,'worker','Worker','2026-03-16 00:48:50');
/*!40000 ALTER TABLE `roles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `workers`
--

DROP TABLE IF EXISTS `workers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `workers` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned DEFAULT NULL,
  `username` varchar(80) DEFAULT NULL,
  `email` varchar(160) DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `profile_image` varchar(255) DEFAULT NULL,
  `name` varchar(120) NOT NULL,
  `skill` varchar(80) NOT NULL,
  `location` varchar(120) NOT NULL,
  `rating` decimal(3,2) NOT NULL DEFAULT 0.00,
  `reviews` text DEFAULT NULL,
  `price_per_hour` decimal(10,2) NOT NULL DEFAULT 0.00,
  `bio` text DEFAULT NULL,
  `portfolio` text DEFAULT NULL,
  `verified` tinyint(1) NOT NULL DEFAULT 0,
  `availability` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `rejection_reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workers_username` (`username`),
  UNIQUE KEY `uq_workers_email` (`email`),
  UNIQUE KEY `idx_workers_username` (`username`),
  UNIQUE KEY `idx_workers_email` (`email`),
  KEY `idx_workers_skill` (`skill`),
  KEY `idx_workers_location` (`location`),
  KEY `idx_workers_verified` (`verified`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `workers`
--

LOCK TABLES `workers` WRITE;
/*!40000 ALTER TABLE `workers` DISABLE KEYS */;
INSERT INTO `workers` VALUES (1,NULL,NULL,NULL,NULL,NULL,'John Mwangi','Plumber','Kajiado Town',4.60,'[{\"user\":\"Asha\",\"text\":\"Fixed my leaking roof quickly.\",\"rating\":5}]',800.00,'Experienced plumber with 8 years in residential plumbing.','[\"assets/img/portfolio1.jpg\",\"assets/img/portfolio2.jpg\"]',1,'[\"2025-11-10\",\"2025-11-12\"]','2026-03-16 00:48:50',NULL),(2,NULL,NULL,NULL,NULL,NULL,'Grace Njeri','Electrician','Kitengela',4.80,'[{\"user\":\"Peter\",\"text\":\"Professional and punctual.\",\"rating\":5}]',1000.00,'Certified electrician for domestic and small commercial jobs.','[\"assets/img/portfolio3.jpg\"]',0,'[\"2025-11-08\",\"2025-11-20\"]','2026-03-16 00:48:50',NULL),(3,NULL,'moses','mosesw@gmail.com','$2a$10$ygGmk9ly1bYcyRZvN/NBeeqCPf7lw9Rs7lN5t0N9Vj7DV4sOfHiRa',NULL,'Moses wambija','electrician','Kajiado',4.00,'[{\"booking_id\":1,\"client_id\":2,\"client_name\":\"pierrairis\",\"rating\":4,\"review\":\"very professional\\ngood service\",\"created_at\":\"2026-03-18T17:14:31.428Z\"}]',400.00,'I’m a dedicated local electrician with a passion for delivering safe, reliable, and high-quality electrical solutions. With several years of hands-on experience, I specialize in installations, repairs, and troubleshooting for both homes and businesses. I take pride in doing the job right the first time, paying close attention to detail and ensuring everything meets safety standards. My goal is to provide honest service, clear communication, and dependable results that my clients can trust.','[]',1,'[\"mon- fri\"]','2026-03-18 00:40:33',NULL),(4,NULL,'john','johnm@gmail.com','$2a$10$aA9loBAo8zmn/TZBIr7d2eFJSnZXzLxzJ75j1mcWtKrdFptb8Q73q',NULL,'john mwangi','plumber','Kajiado',0.00,'[]',400.00,'I’m a skilled local plumber committed to providing reliable and efficient plumbing solutions for homes and businesses. With years of hands-on experience, I handle everything from installations and repairs to troubleshooting leaks and drainage issues.','[]',0,'[\"mon- fri\"]','2026-03-18 20:35:18',NULL),(5,NULL,'paul','paulm@gmail.com','$2a$10$rhvKlzLBfR2m0oASDY4IpeBHH5aM0hQ77tNZlsKvvztfoE/zjYRnG',NULL,'Paul mwangi','plumber','Kajiado',4.00,'[{\"booking_id\":3,\"client_id\":2,\"client_name\":\"pierrairis\",\"rating\":4,\"review\":\"very proffesional \\ngood service\",\"created_at\":\"2026-03-18T17:54:38.603Z\"}]',0.00,'New worker profile. Update details from your dashboard.','[]',1,'[]','2026-03-18 20:50:53',NULL);
/*!40000 ALTER TABLE `workers` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-04-16 10:00:45
