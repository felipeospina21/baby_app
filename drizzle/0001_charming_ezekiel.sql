ALTER TABLE "baby_app_nap" ADD COLUMN "userId" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "baby_app_user" ADD COLUMN "hashedPassword" varchar(255);--> statement-breakpoint
ALTER TABLE "baby_app_nap" ADD CONSTRAINT "baby_app_nap_userId_baby_app_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."baby_app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nap_user_id_idx" ON "baby_app_nap" USING btree ("userId");