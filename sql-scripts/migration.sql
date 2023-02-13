-- CreateTable
CREATE TABLE "logs" (
    "tag" Text NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,
    "id" SERIAL NOT NULL,

    CONSTRAINT "Logs_pkey" PRIMARY KEY ("id")
);
