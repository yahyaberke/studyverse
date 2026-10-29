-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MENTION');

-- AlterTable
ALTER TABLE "SessionSegment" ADD COLUMN     "subjectId" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "soundBreak" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "soundJoinLeave" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "soundMention" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "soundStudy" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "soundSubject" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "actorId" TEXT,
    "roomId" TEXT,
    "messageId" TEXT,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_type_messageId_key" ON "Notification"("userId", "type", "messageId");

-- AddForeignKey
ALTER TABLE "SessionSegment" ADD CONSTRAINT "SessionSegment_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: existing segments inherit their session's subject so per-subject stats stay identical
UPDATE "SessionSegment" g SET "subjectId" = s."subjectId" FROM "StudySession" s WHERE g."sessionId" = s.id AND g."subjectId" IS NULL;
