       IDENTIFICATION DIVISION.
       PROGRAM-ID. LEASEBIL.
      *****************************************************************
      * LEASEBIL  MONTHLY RENT, CAM AND OPEX PASS-THROUGH BILLING      *
      * RUN NIGHTLY BY INVBATCH STEP010                                *
      * 1994-03  R.OKAFOR   ORIGINAL                                   *
      * 1999-11  R.OKAFOR   Y2K: TWO-DIGIT YEAR WINDOW (PIVOT 50)      *
      * 2011-02  J.PATEL    SLA CREDIT FOR DATA CENTER TENANTS         *
      * 2019-01  J.PATEL    OPEX BASE YEAR SET TO 2019                 *
      *****************************************************************
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT LEASE-IN  ASSIGN TO "LEASEIN.DAT"
               ORGANIZATION IS LINE SEQUENTIAL.
           SELECT COOL-FLAG ASSIGN TO "COOLFLAG.DAT"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-CF-STATUS.
           SELECT INV-OUT   ASSIGN TO "INVOICE.DAT"
               ORGANIZATION IS LINE SEQUENTIAL.
       DATA DIVISION.
       FILE SECTION.
       FD  LEASE-IN.
       01  LI-REC.
           05  LI-TENANT-ID            PIC X(6).
           05  LI-SQFT                 PIC 9(7).
           05  LI-RENT-PSF             PIC 9(3)V99.
           05  LI-ESC-PCT              PIC V9999.
           05  LI-START-YY             PIC 99.
           05  LI-BILL-YEAR            PIC 9(4).
           05  LI-CAP-PCT              PIC V9999.
           05  LI-BLDG-TOTAL-SF        PIC 9(7).
           05  LI-BLDG-OCC-SF          PIC 9(7).
           05  LI-CAM-POOL-MO          PIC 9(7)V99.
           05  LI-MONTHLY-FEE          PIC 9(7)V99.
           05  LI-SLA-PCT              PIC 99.
           05  LI-ADJ-SIGN             PIC X.
           05  LI-ADJ-AMT              PIC 9(5)V99.
       FD  COOL-FLAG.
       01  CF-REC.
           05  CF-FLAG                 PIC X.
           05  FILLER                  PIC X(19).
       FD  INV-OUT.
       01  INV-LINE                    PIC X(100).
       WORKING-STORAGE SECTION.
       COPY LEASECPY.
       01  WS-CF-STATUS                PIC XX.
       01  WS-EOF                      PIC X      VALUE "N".
       01  WS-COOL                     PIC X      VALUE "N".
      * OPEX BASE YEAR FOR ALL BASE-YEAR LEASES
       01  WS-BASE-YEAR                PIC 9(4)   VALUE 2019.
       01  WS-OPEX-TABLE.
           05  FILLER                  PIC X(9)   VALUE "201901120".
           05  FILLER                  PIC X(9)   VALUE "202001160".
           05  FILLER                  PIC X(9)   VALUE "202101205".
           05  FILLER                  PIC X(9)   VALUE "202201250".
           05  FILLER                  PIC X(9)   VALUE "202301295".
           05  FILLER                  PIC X(9)   VALUE "202401340".
           05  FILLER                  PIC X(9)   VALUE "202501390".
           05  FILLER                  PIC X(9)   VALUE "202601435".
       01  WS-OPEX-TBL REDEFINES WS-OPEX-TABLE.
           05  WS-OPEX-ENTRY OCCURS 8 TIMES INDEXED BY OX.
               10  OT-YEAR             PIC 9(4).
               10  OT-PSF              PIC 9(3)V99.
       01  WS-START-YEAR               PIC 9(4).
       01  WS-YEARS                    PIC S9(3).
       01  WS-ESC-RENT-PSF             PIC S9(5)V9(6) COMP-3.
       01  WS-BASE-RENT-MO             PIC S9(7)V99   COMP-3.
       01  WS-CAM-SHARE                PIC S9V9(6)    COMP-3.
       01  WS-CAM-CHG                  PIC S9(7)V99   COMP-3.
       01  WS-OPEX-CUR                 PIC 9(3)V99.
       01  WS-OPEX-BASE                PIC 9(3)V99.
       01  WS-OPEX-PASS                PIC S9(7)V99   COMP-3.
       01  WS-CAP-AMT                  PIC S9(7)V99   COMP-3.
       01  WS-SLA-CREDIT               PIC S9(7)V99   COMP-3.
       01  WS-ADJ                      PIC S9(5)V99   COMP-3.
       01  WS-TOTAL                    PIC S9(7)V99   COMP-3.
       01  WS-OUT.
           05  O-TENANT                PIC X(6).
           05  FILLER                  PIC X      VALUE SPACE.
           05  O-RENT                  PIC -,---,--9.99.
           05  FILLER                  PIC X      VALUE SPACE.
           05  O-CAM                   PIC -,---,--9.99.
           05  FILLER                  PIC X      VALUE SPACE.
           05  O-OPEX                  PIC -,---,--9.99.
           05  FILLER                  PIC X      VALUE SPACE.
           05  O-SLA                   PIC -,---,--9.99.
           05  FILLER                  PIC X      VALUE SPACE.
           05  O-ADJ                   PIC -,---,--9.99.
           05  FILLER                  PIC X      VALUE SPACE.
           05  O-TOTAL                 PIC -,---,--9.99.
       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-READ-COOL-FLAG
           OPEN INPUT LEASE-IN
           OPEN OUTPUT INV-OUT
           PERFORM UNTIL WS-EOF = "Y"
               READ LEASE-IN
                   AT END MOVE "Y" TO WS-EOF
                   NOT AT END PERFORM 2000-BILL-ONE
               END-READ
           END-PERFORM
           CLOSE LEASE-IN
           CLOSE INV-OUT
           STOP RUN.
       1000-READ-COOL-FLAG.
      * THERMAL FLAG FILE WRITTEN BY THE BMS EXPORT JOB (BMSEXP).
      * Y = DATA HALL OVER TEMPERATURE, TRIGGERS SLA CREDIT BELOW.
           MOVE "N" TO WS-COOL
           OPEN INPUT COOL-FLAG
           IF WS-CF-STATUS = "00"
               READ COOL-FLAG
                   NOT AT END MOVE CF-FLAG TO WS-COOL
               END-READ
               CLOSE COOL-FLAG
           END-IF.
       2000-BILL-ONE.
           MOVE LI-TENANT-ID     TO LR-TENANT-ID
           MOVE LI-SQFT          TO LR-SQFT
           MOVE LI-RENT-PSF      TO LR-RENT-PSF
           MOVE LI-ESC-PCT       TO LR-ESC-PCT
           MOVE LI-CAP-PCT       TO LR-CAP-PCT
           MOVE LI-BLDG-TOTAL-SF TO LR-BLDG-TOTAL-SF
           MOVE LI-BLDG-OCC-SF   TO LR-BLDG-OCC-SF
           MOVE LI-CAM-POOL-MO   TO LR-CAM-POOL-MO
           MOVE LI-MONTHLY-FEE   TO LR-MONTHLY-FEE
           MOVE LI-SLA-PCT       TO LR-SLA-PCT
           PERFORM 2100-YEAR-WINDOW
           PERFORM 2200-BASE-RENT
           PERFORM 2300-CAM-SHARE
           PERFORM 2400-BASE-YEAR-STOP
           PERFORM 2500-APPLY-CAP
           PERFORM 2600-SLA-CREDIT
           PERFORM 2650-ADJUSTMENT
           PERFORM 2700-TOTAL
           PERFORM 2900-WRITE-INVOICE.
       2100-YEAR-WINDOW.
           IF LI-START-YY < 50
               COMPUTE WS-START-YEAR = 2000 + LI-START-YY
           ELSE
               COMPUTE WS-START-YEAR = 1900 + LI-START-YY
           END-IF
           COMPUTE WS-YEARS = LI-BILL-YEAR - WS-START-YEAR.
       2200-BASE-RENT.
           MOVE LR-RENT-PSF TO WS-ESC-RENT-PSF
           IF WS-YEARS > 0
               PERFORM WS-YEARS TIMES
                   COMPUTE WS-ESC-RENT-PSF ROUNDED =
                       WS-ESC-RENT-PSF * (1 + LR-ESC-PCT)
               END-PERFORM
           END-IF
           COMPUTE WS-BASE-RENT-MO ROUNDED =
               WS-ESC-RENT-PSF * LR-SQFT / 12.
       2300-CAM-SHARE.
           CALL "CAMCALC" USING LEASE-REC WS-CAM-SHARE
           COMPUTE WS-CAM-CHG = LR-CAM-POOL-MO * WS-CAM-SHARE.
       2400-BASE-YEAR-STOP.
           MOVE 0 TO WS-OPEX-CUR WS-OPEX-BASE
           PERFORM VARYING OX FROM 1 BY 1 UNTIL OX > 8
               IF OT-YEAR (OX) = LI-BILL-YEAR
                   MOVE OT-PSF (OX) TO WS-OPEX-CUR
               END-IF
               IF OT-YEAR (OX) = WS-BASE-YEAR
                   MOVE OT-PSF (OX) TO WS-OPEX-BASE
               END-IF
           END-PERFORM
           COMPUTE WS-OPEX-PASS ROUNDED =
               (WS-OPEX-CUR - WS-OPEX-BASE) * LR-SQFT / 12.
       2500-APPLY-CAP.
           IF LR-CAP-PCT > 0
               COMPUTE WS-CAP-AMT ROUNDED =
                   WS-OPEX-BASE * LR-CAP-PCT
                   * (LI-BILL-YEAR - WS-BASE-YEAR) * LR-SQFT / 12
               IF WS-OPEX-PASS > WS-CAP-AMT
                   MOVE WS-CAP-AMT TO WS-OPEX-PASS
               END-IF
           END-IF.
       2600-SLA-CREDIT.
           MOVE 0 TO WS-SLA-CREDIT
           IF WS-COOL = "Y" AND LR-SLA-PCT > 0
               COMPUTE WS-SLA-CREDIT ROUNDED =
                   LR-MONTHLY-FEE * LR-SLA-PCT / 100
           END-IF.
       2650-ADJUSTMENT.
           IF LI-ADJ-SIGN = "-"
               COMPUTE WS-ADJ = 0 - LI-ADJ-AMT
           ELSE
               MOVE LI-ADJ-AMT TO WS-ADJ
           END-IF.
       2700-TOTAL.
           COMPUTE WS-TOTAL = WS-BASE-RENT-MO + WS-CAM-CHG
               + WS-OPEX-PASS - WS-SLA-CREDIT + WS-ADJ.
       2900-WRITE-INVOICE.
           MOVE LR-TENANT-ID    TO O-TENANT
           MOVE WS-BASE-RENT-MO TO O-RENT
           MOVE WS-CAM-CHG      TO O-CAM
           MOVE WS-OPEX-PASS    TO O-OPEX
           MOVE WS-SLA-CREDIT   TO O-SLA
           MOVE WS-ADJ          TO O-ADJ
           MOVE WS-TOTAL        TO O-TOTAL
           MOVE WS-OUT          TO INV-LINE
           WRITE INV-LINE.
