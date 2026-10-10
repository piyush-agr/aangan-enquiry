import { hashPassword } from "../../src/lib/auth/password";
import { closeDb, db } from "../../src/lib/db/client";
import { users } from "../../src/lib/db/schema";

(async () => {
  await db().insert(users).values({ email: "staff@e2e.test", name: "Front Desk", role: "STAFF", passwordHash: await hashPassword("e2e-staff-password") });
  await closeDb();
})();
