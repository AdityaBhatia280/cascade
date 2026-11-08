       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEASEBIL.
       AUTHOR.     D-KOWALSKI.
       DATE-WRITTEN. 2017-06-15.
      ******************************************************************
      * LEASEBIL - MONTHLY RENT AND CAM BILLING PROGRAM
      * READS LEASE MASTER FILE AND PRODUCES INVOICES
      * CALLS CAMCALC SUBPROGRAM FOR PRO-RATA SHARE AND CAP
      *
      * CHANGE LOG:
      *   2018-09-14 - ADDED SLA CREDIT PROCESSING
      *   2018-01-20 - ADDED CAM RECONCILIATION
      *   2017-06-15 - INITIAL RELEASE
      *
      * NOTE: METERREAD SUBPROGRAM INTEGRATION PLANNED FOR Q3 2019
      *       SEE PROJECT PLAN MTR-2019-001
      ******************************************************************
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-390.
       OBJECT-COMPUTER. IBM-390.

       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT LEASE-FILE ASSIGN TO LEASEMST
               ORGANIZATION IS INDEXED
               ACCESS MODE IS SEQUENTIAL
               RECORD KEY IS LM-TENANT-ID
               FILE STATUS IS WS-LEASE-FS.

           SELECT INVOICE-FILE ASSIGN TO INVOUT
               ORGANIZATION IS SEQUENTIAL
               FILE STATUS IS WS-INV-FS.

           SELECT COOL-STATUS-FILE ASSIGN TO COOLSTAT
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-COOL-FS.

           SELECT REPORT-FILE ASSIGN TO BILRPT
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-RPT-FS.

       DATA DIVISION.
       FILE SECTION.

       FD  LEASE-FILE
           LABEL RECORDS ARE STANDARD
           BLOCK CONTAINS 0 RECORDS.
       01  LEASE-IN-REC.
           COPY LEASECPY.

       FD  INVOICE-FILE
           LABEL RECORDS ARE STANDARD.
       01  INVOICE-OUT-REC               PIC X(200).

       FD  COOL-STATUS-FILE.
       01  COOL-STATUS-REC.
           05  CS-UNIT-ID                PIC X(8).
           05  CS-STATUS                 PIC X(1).
           05  CS-TIMESTAMP              PIC X(19).
           05  CS-DURATION-MIN           PIC 9(4).
           05  CS-DETAIL                 PIC X(48).

       FD  REPORT-FILE.
       01  REPORT-REC                    PIC X(132).

       WORKING-STORAGE SECTION.

       01  WS-FILE-STATUS-BLOCK.
           05  WS-LEASE-FS              PIC XX.
           05  WS-INV-FS               PIC XX.
           05  WS-COOL-FS              PIC XX.
           05  WS-RPT-FS               PIC XX.

       01  WS-FLAGS.
           05  WS-EOF-FLAG             PIC X(1)    VALUE 'N'.
               88  WS-EOF              VALUE 'Y'.
               88  WS-NOT-EOF          VALUE 'N'.
           05  WS-COOL-EOF             PIC X(1)    VALUE 'N'.
               88  WS-COOL-END         VALUE 'Y'.
           05  WS-ERR-FLAG             PIC X(1)    VALUE 'N'.
               88  WS-ERROR            VALUE 'Y'.

       01  WS-COUNTERS.
           05  WS-RECORDS-READ         PIC 9(7)    VALUE ZEROS.
           05  WS-RECORDS-WRITTEN      PIC 9(7)    VALUE ZEROS.
           05  WS-RECORDS-SKIPPED      PIC 9(7)    VALUE ZEROS.
           05  WS-SLA-CREDITS-APPLIED  PIC 9(5)    VALUE ZEROS.

       01  WS-BILLING-FIELDS.
           05  WS-BASE-YEAR            PIC 9(4)    VALUE 2019.
           05  WS-CURRENT-YEAR         PIC 9(4).
           05  WS-EXPENSE-INCREASE     PIC S9(7)V99 COMP-3.
           05  WS-CAM-PER-SF           PIC S9(7)V99 COMP-3.
           05  WS-CAM-MONTHLY          PIC S9(9)V99 COMP-3.
           05  WS-RENT-MONTHLY         PIC S9(9)V99 COMP-3.
           05  WS-TOTAL-CHARGE         PIC S9(9)V99 COMP-3.
           05  WS-ESCALATED-RENT       PIC S9(9)V99 COMP-3.
           05  WS-YEARS-ELAPSED        PIC 9(3)     COMP-3.
           05  WS-ESCALATION-FACTOR    PIC 9(3)V9(6) COMP-3.
           05  WS-BADGE-SYNC-TOKEN     PIC X(16)    VALUE SPACES.

       01  WS-SLA-FIELDS.
           05  WS-SLA-PCT              PIC 9(3)V99  COMP-3.
           05  WS-SLA-CREDIT           PIC S9(7)V99 COMP-3.
           05  WS-COOL-DURATION        PIC 9(4).
           05  WS-COOL-STATUS          PIC X(1).
           05  WS-COOL-UNIT-ID         PIC X(8).

       01  WS-CAP-FIELDS.
           05  WS-CAP-LIMIT            PIC S9(7)V99 COMP-3.
           05  WS-CAPPED-INCREASE      PIC S9(7)V99 COMP-3.
           05  WS-PRIOR-EXPENSE        PIC S9(5)V99 COMP-3.
           05  WS-CUMUL-INCREASE       PIC S9(7)V99 COMP-3.

       01  WS-DATE-FIELDS.
           05  WS-CURRENT-DATE-X.
               10  WS-CURR-YYYY       PIC 9(4).
               10  WS-CURR-MM         PIC 9(2).
               10  WS-CURR-DD         PIC 9(2).
           05  WS-DATE-NUM REDEFINES WS-CURRENT-DATE-X
                                       PIC 9(8).
      * Y2K COMPATIBILITY WINDOW - DATES 00-49 = 2000-2049
      *                            DATES 50-99 = 1950-1999
           05  WS-YY-WINDOW            PIC 9(2).
           05  WS-CENTURY              PIC 9(2).
           05  WS-FULL-YEAR            PIC 9(4).

       01  WS-INVOICE-RECORD.
           05  WS-INV-TENANT-ID        PIC X(10).
           05  WS-INV-UNIT-ID          PIC X(8).
           05  WS-INV-DATE             PIC 9(8).
           05  WS-INV-BASE-RENT        PIC 9(7)V99.
           05  WS-INV-CAM-CHARGE       PIC 9(7)V99.
           05  WS-INV-SLA-CREDIT       PIC S9(7)V99.
           05  WS-INV-TOTAL            PIC S9(9)V99.
           05  WS-INV-FILLER           PIC X(140).

       01  WS-DISPLAY-FIELDS.
           05  WS-DISP-RENT            PIC $$$,$$$,$$9.99.
           05  WS-DISP-CAM             PIC $$$,$$$,$$9.99.
           05  WS-DISP-CREDIT          PIC -$$$,$$9.99.
           05  WS-DISP-TOTAL           PIC $$$$,$$$,$$9.99.

       01  WS-CAMCALC-PARMS.
           05  WS-CC-TENANT-AREA       PIC 9(7)V99  COMP-3.
           05  WS-CC-BLDG-TOTAL        PIC 9(7)V99  COMP-3.
           05  WS-CC-OCCUPIED          PIC 9(7)V99  COMP-3.
           05  WS-CC-EXPENSE-INC       PIC S9(7)V99 COMP-3.
           05  WS-CC-CAP-TYPE          PIC X(2).
           05  WS-CC-CAP-PCT           PIC 9(3)V99  COMP-3.
           05  WS-CC-PRO-RATA-METH     PIC X(1).
           05  WS-CC-RESULT-MO         PIC S9(9)V99 COMP-3.
           05  WS-CC-SHARE-PCT         PIC 9(3)V9(4) COMP-3.
           05  WS-CC-RETURN-CODE       PIC 9(2).

       PROCEDURE DIVISION.

       0000-MAIN-CONTROL.
           PERFORM 1000-INITIALIZE
           PERFORM 2000-PROCESS-LEASES
               UNTIL WS-EOF
           PERFORM 9000-TERMINATE
           STOP RUN.

       1000-INITIALIZE.
           OPEN INPUT  LEASE-FILE
           OPEN INPUT  COOL-STATUS-FILE
           OPEN OUTPUT INVOICE-FILE
           OPEN OUTPUT REPORT-FILE
           IF WS-LEASE-FS NOT = '00'
               DISPLAY 'ERROR OPENING LEASE FILE: ' WS-LEASE-FS
               MOVE 'Y' TO WS-ERR-FLAG
           END-IF
           IF WS-COOL-FS NOT = '00'
               DISPLAY 'WARNING: COOLFLAG.DAT NOT AVAILABLE'
               DISPLAY '  STATUS: ' WS-COOL-FS
               MOVE 'Y' TO WS-COOL-EOF
           END-IF
           ACCEPT WS-CURRENT-DATE-X FROM DATE YYYYMMDD
           MOVE WS-CURR-YYYY TO WS-CURRENT-YEAR
           PERFORM 2100-LEASE-READ.

       2000-PROCESS-LEASES.
           IF LM-ACTIVE
               PERFORM 3000-BASE-RENT-CALC
               PERFORM 4000-CAM-SHARE-CALC
               PERFORM 5000-SLA-CREDIT-CALC
               PERFORM 6000-BUILD-INVOICE
               PERFORM 6500-WRITE-INVOICE
           ELSE
               ADD 1 TO WS-RECORDS-SKIPPED
           END-IF
           PERFORM 2100-LEASE-READ.

       2100-LEASE-READ.
           READ LEASE-FILE INTO LEASE-MASTER-RECORD
               AT END
                   SET WS-EOF TO TRUE
               NOT AT END
                   ADD 1 TO WS-RECORDS-READ
           END-READ.

      ******************************************************************
      * BASE RENT CALCULATION WITH ANNUAL ESCALATION
      ******************************************************************
       3000-BASE-RENT-CALC.
           MOVE LM-BASE-RENT-MO TO WS-RENT-MONTHLY
           IF LM-RENT-ESCALATION > 0
               COMPUTE WS-YEARS-ELAPSED =
                   WS-CURRENT-YEAR - WS-BASE-YEAR
               COMPUTE WS-ESCALATION-FACTOR =
                   (1 + (LM-RENT-ESCALATION / 100))
                   ** WS-YEARS-ELAPSED
               COMPUTE WS-ESCALATED-RENT =
                   WS-RENT-MONTHLY * WS-ESCALATION-FACTOR
               MOVE WS-ESCALATED-RENT TO WS-RENT-MONTHLY
           END-IF.

      ******************************************************************
      * CAM SHARE CALCULATION - CALLS CAMCALC SUBPROGRAM
      ******************************************************************
       4000-CAM-SHARE-CALC.
      *    COMPUTE EXPENSE INCREASE OVER BASE YEAR
      *    BUG: WS-BASE-YEAR IS HARDCODED TO 2019 IN WORKING-STORAGE
      *         SOME LEASE AMENDMENTS HAVE MOVED BASE YEAR FORWARD
           PERFORM 4100-BASE-YEAR-STOP
           PERFORM 4200-CALL-CAMCALC
           PERFORM 4300-CAP-APPLY.

       4100-BASE-YEAR-STOP.
      *    APPLY BASE YEAR STOP - TENANT ONLY PAYS INCREASES
      *    ABOVE THE BASE YEAR EXPENSE LEVEL
           COMPUTE WS-EXPENSE-INCREASE =
               LM-CURR-EXPENSE-SF - LM-BASE-EXPENSE-SF
           IF WS-EXPENSE-INCREASE < 0
               MOVE ZEROS TO WS-EXPENSE-INCREASE
           END-IF.

       4200-CALL-CAMCALC.
           MOVE LM-TENANT-AREA-SF  TO WS-CC-TENANT-AREA
           MOVE LM-BLDG-TOTAL-SF   TO WS-CC-BLDG-TOTAL
           MOVE LM-OCCUPIED-SF     TO WS-CC-OCCUPIED
           MOVE WS-EXPENSE-INCREASE TO WS-CC-EXPENSE-INC
           MOVE LM-CAM-CAP-TYPE    TO WS-CC-CAP-TYPE
           MOVE LM-CAM-CAP-PCT     TO WS-CC-CAP-PCT
           MOVE LM-PRO-RATA-METHOD TO WS-CC-PRO-RATA-METH
           CALL 'CAMCALC' USING WS-CAMCALC-PARMS
           IF WS-CC-RETURN-CODE NOT = 0
               DISPLAY 'CAMCALC ERROR FOR TENANT: '
                   LM-TENANT-ID ' RC=' WS-CC-RETURN-CODE
           END-IF
           MOVE WS-CC-RESULT-MO TO WS-CAM-MONTHLY.

       4300-CAP-APPLY.
      *    CAP APPLICATION IS HANDLED IN CAMCALC
      *    THIS PARAGRAPH LOGS THE CAPPED RESULT
           IF LM-CAM-CAP-TYPE NOT = '  '
               DISPLAY 'CAP APPLIED FOR ' LM-TENANT-ID
                   ' TYPE=' LM-CAM-CAP-TYPE
                   ' MONTHLY CAM=' WS-CAM-MONTHLY
           END-IF.

      ******************************************************************
      * SLA CREDIT CALCULATION - READS COOLFLAG.DAT
      * COOLFLAG.DAT IS PRODUCED BY BMS EXPORT PROCESS
      ******************************************************************
       5000-SLA-CREDIT-CALC.
           MOVE ZEROS TO WS-SLA-CREDIT
           IF LM-SLA-TIER > 0
               PERFORM 5100-READ-COOL-STATUS
           END-IF.

       5100-READ-COOL-STATUS.
           IF WS-COOL-END
               GO TO 5100-EXIT
           END-IF
           READ COOL-STATUS-FILE INTO COOL-STATUS-REC
               AT END
                   SET WS-COOL-END TO TRUE
                   GO TO 5100-EXIT
               NOT AT END
                   MOVE CS-STATUS TO WS-COOL-STATUS
                   MOVE CS-DURATION-MIN TO WS-COOL-DURATION
                   MOVE CS-UNIT-ID TO WS-COOL-UNIT-ID
           END-READ
           IF WS-COOL-STATUS = 'N'
               PERFORM 5200-COMPUTE-SLA-CREDIT
           END-IF.
       5100-EXIT.
           EXIT.

       5200-COMPUTE-SLA-CREDIT.
      *    SLA CREDIT TIERS BASED ON COOLING OUTAGE DURATION
      *    TIER 1: 0-60 MIN   =  5% OF MONTHLY FEE
      *    TIER 2: 61-240 MIN = 10% OF MONTHLY FEE
      *    TIER 3: 241-480 MIN = 20% OF MONTHLY FEE
      *    TIER 4: 480+ MIN   = 30% OF MONTHLY FEE
           EVALUATE TRUE
               WHEN WS-COOL-DURATION <= 60
                   MOVE 5.00 TO WS-SLA-PCT
               WHEN WS-COOL-DURATION <= 240
                   MOVE 10.00 TO WS-SLA-PCT
               WHEN WS-COOL-DURATION <= 480
                   MOVE 20.00 TO WS-SLA-PCT
               WHEN OTHER
                   MOVE 30.00 TO WS-SLA-PCT
           END-EVALUATE
           COMPUTE WS-SLA-CREDIT =
               LM-MONTHLY-FEE * (WS-SLA-PCT / 100).
           ADD 1 TO WS-SLA-CREDITS-APPLIED.

      ******************************************************************
      * BUILD AND WRITE INVOICE RECORD
      ******************************************************************
       6000-BUILD-INVOICE.
      *    NOTE: TOTAL CHARGE COMPUTE DOES NOT USE ROUNDED
           COMPUTE WS-TOTAL-CHARGE =
               WS-RENT-MONTHLY + WS-CAM-MONTHLY
               - WS-SLA-CREDIT
           MOVE LM-TENANT-ID    TO WS-INV-TENANT-ID
           MOVE LM-UNIT-ID      TO WS-INV-UNIT-ID
           MOVE WS-DATE-NUM     TO WS-INV-DATE
           MOVE WS-RENT-MONTHLY TO WS-INV-BASE-RENT
           MOVE WS-CAM-MONTHLY  TO WS-INV-CAM-CHARGE
           MOVE WS-SLA-CREDIT   TO WS-INV-SLA-CREDIT
           MOVE WS-TOTAL-CHARGE TO WS-INV-TOTAL.

       6500-WRITE-INVOICE.
           WRITE INVOICE-OUT-REC FROM WS-INVOICE-RECORD
           IF WS-INV-FS NOT = '00'
               DISPLAY 'ERROR WRITING INVOICE: ' WS-INV-FS
           ELSE
               ADD 1 TO WS-RECORDS-WRITTEN
           END-IF.

      ******************************************************************
      * Y2K DATE WINDOW CONVERSION (LEGACY)
      ******************************************************************
       7000-CONVERT-YY-TO-YYYY.
           IF WS-YY-WINDOW <= 49
               MOVE 20 TO WS-CENTURY
           ELSE
               MOVE 19 TO WS-CENTURY
           END-IF
           COMPUTE WS-FULL-YEAR =
               (WS-CENTURY * 100) + WS-YY-WINDOW.

      ******************************************************************
      * TERMINATION AND REPORTING
      ******************************************************************
       9000-TERMINATE.
           DISPLAY '========================================='
           DISPLAY 'LEASEBIL BATCH COMPLETE'
           DISPLAY 'RECORDS READ:    ' WS-RECORDS-READ
           DISPLAY 'INVOICES WRITTEN:' WS-RECORDS-WRITTEN
           DISPLAY 'RECORDS SKIPPED: ' WS-RECORDS-SKIPPED
           DISPLAY 'SLA CREDITS:     ' WS-SLA-CREDITS-APPLIED
           DISPLAY '========================================='
           CLOSE LEASE-FILE
           CLOSE INVOICE-FILE
           CLOSE COOL-STATUS-FILE
           CLOSE REPORT-FILE.
