CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"hand_id" text,
	"description" text NOT NULL,
	"debit_owner" text NOT NULL,
	"debit_type" text NOT NULL,
	"credit_owner" text NOT NULL,
	"credit_type" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cashouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"token_amount" bigint NOT NULL,
	"real_money_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"hold_idempotency_key" text NOT NULL,
	"settle_idempotency_key" text NOT NULL,
	"actioned_by_admin_id" uuid,
	"action_reason" text,
	"actioned_at" timestamp with time zone,
	"payment_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"token_amount" bigint NOT NULL,
	"real_money_minor" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"approve_idempotency_key" text NOT NULL,
	"actioned_by_admin_id" uuid,
	"action_reason" text,
	"actioned_at" timestamp with time zone,
	"payment_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"table_id" text NOT NULL,
	"seat_index" integer NOT NULL,
	"buy_in_minor" bigint NOT NULL,
	"stack_minor" bigint DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "table_records" (
	"table_id" text PRIMARY KEY NOT NULL,
	"hand_state_json" text,
	"seats_json" text DEFAULT '[]' NOT NULL,
	"shuffle_index" integer DEFAULT 0 NOT NULL,
	"config_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hand_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hand_id" text NOT NULL,
	"player_id" text NOT NULL,
	"seat_index" integer NOT NULL,
	"street" text NOT NULL,
	"action" text NOT NULL,
	"amount_minor" bigint DEFAULT 0 NOT NULL,
	"seq" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hand_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hand_id" text NOT NULL,
	"player_id" text NOT NULL,
	"seat_index" integer NOT NULL,
	"hole_cards_json" text,
	"hand_rank" text,
	"contributed_minor" bigint DEFAULT 0 NOT NULL,
	"won_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hands" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"dealer_seat" integer NOT NULL,
	"sb_seat" integer NOT NULL,
	"bb_seat" integer NOT NULL,
	"pot_total_minor" bigint DEFAULT 0 NOT NULL,
	"rake_minor" bigint DEFAULT 0 NOT NULL,
	"rng_commit" text NOT NULL,
	"rng_reveal" text,
	"rng_client_seed" text NOT NULL,
	"rng_shuffle_index" integer NOT NULL,
	"board_json" text,
	"phase" text DEFAULT 'preflop' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"details_json" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_id_user_id_fk" FOREIGN KEY ("id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashouts" ADD CONSTRAINT "cashouts_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashouts" ADD CONSTRAINT "cashouts_actioned_by_admin_id_admins_id_fk" FOREIGN KEY ("actioned_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_actioned_by_admin_id_admins_id_fk" FOREIGN KEY ("actioned_by_admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_actions" ADD CONSTRAINT "hand_actions_hand_id_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_results" ADD CONSTRAINT "hand_results_hand_id_hands_id_fk" FOREIGN KEY ("hand_id") REFERENCES "public"."hands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hand_results" ADD CONSTRAINT "hand_results_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_idx" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_debit_idx" ON "ledger_entries" USING btree ("debit_owner","debit_type");--> statement-breakpoint
CREATE INDEX "ledger_entries_credit_idx" ON "ledger_entries" USING btree ("credit_owner","credit_type");--> statement-breakpoint
CREATE INDEX "ledger_entries_hand_idx" ON "ledger_entries" USING btree ("hand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_username_idx" ON "players" USING btree ("username");--> statement-breakpoint
CREATE INDEX "cashouts_player_idx" ON "cashouts" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "cashouts_status_idx" ON "cashouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "token_purchases_player_idx" ON "token_purchases" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "token_purchases_status_idx" ON "token_purchases" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_player_idx" ON "sessions" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "sessions_table_idx" ON "sessions" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "hand_actions_hand_idx" ON "hand_actions" USING btree ("hand_id","seq");--> statement-breakpoint
CREATE INDEX "hand_results_hand_idx" ON "hand_results" USING btree ("hand_id");--> statement-breakpoint
CREATE INDEX "hand_results_player_idx" ON "hand_results" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "hands_table_idx" ON "hands" USING btree ("table_id");--> statement-breakpoint
CREATE INDEX "hands_started_idx" ON "hands" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "admin_audit_log_admin_idx" ON "admin_audit_log" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");