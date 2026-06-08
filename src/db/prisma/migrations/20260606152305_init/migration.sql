-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('PENDING', 'ENTRY_OPEN', 'ENTRY_MISSED', 'TP_HIT', 'SL_HIT', 'EXPIRED');

-- CreateTable
CREATE TABLE "Admin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalSignals" INTEGER NOT NULL DEFAULT 0,
    "totalWins" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entryMin" DOUBLE PRECISION NOT NULL,
    "entryMax" DOUBLE PRECISION NOT NULL,
    "tpPercent" DOUBLE PRECISION NOT NULL,
    "slPercent" DOUBLE PRECISION NOT NULL,
    "tpPrice" DOUBLE PRECISION NOT NULL,
    "slPrice" DOUBLE PRECISION NOT NULL,
    "rrRatio" DOUBLE PRECISION NOT NULL,
    "urgencyScore" INTEGER NOT NULL DEFAULT 0,
    "status" "SignalStatus" NOT NULL DEFAULT 'PENDING',
    "rawText" TEXT NOT NULL,
    "enrichment" JSONB,
    "livePriceAtPost" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "whatsappNumber" TEXT NOT NULL,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fcmToken" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberTrade" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,

    CONSTRAINT "MemberTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Member_whatsappNumber_key" ON "Member"("whatsappNumber");

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTrade" ADD CONSTRAINT "MemberTrade_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTrade" ADD CONSTRAINT "MemberTrade_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
