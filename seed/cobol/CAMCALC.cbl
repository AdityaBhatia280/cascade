       IDENTIFICATION DIVISION.
       PROGRAM-ID. CAMCALC.
       AUTHOR.     D-KOWALSKI.
       DATE-WRITTEN. 2017-06-15.
      ******************************************************************
      * CAMCALC - CAM PRO-RATA SHARE AND CAP SUBPROGRAM
      * CALLED BY LEASEBIL TO COMPUTE MONTHLY CAM CHARGES
      *
      * INPUTS:  TENANT AREA, BUILDING TOTAL, OCCUPIED AREA,
      *          EXPENSE INCREASE, CAP TYPE/PCT, PRO-RATA METHOD
      * OUTPUTS: MONTHLY CAM CHARGE, SHARE PERCENTAGE, RETURN CODE
      *
      * CHANGE LOG:
      *   2018-03-10 - ADDED CUMULATIVE CAP SUPPORT
      *   2017-06-15 - INITIAL RELEASE
      *
      * KNOWN ISSUE: PRO-RATA DENOMINATOR USES OCCUPIED AREA
      *   INSTEAD OF TOTAL BUILDING AREA. SOME LEASES SPECIFY
      *   TOTAL AREA AS DENOMINATOR. SEE TICKET CAM-2021-0047.
      ******************************************************************
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-390.
       OBJECT-COMPUTER. IBM-390.

       DATA DIVISION.

       WORKING-STORAGE SECTION.

       01  WS-INTERNAL-FIELDS.
           05  WS-SHARE-DECIMAL       PIC 9(1)V9(6) COMP-3.
           05  WS-ANNUAL-INCREASE     PIC S9(9)V99  COMP-3.
           05  WS-ANNUAL-PER-TENANT   PIC S9(9)V99  COMP-3.
           05  WS-MONTHLY-CHARGE      PIC S9(9)V99  COMP-3.
           05  WS-CAP-AMOUNT          PIC S9(7)V99  COMP-3.
           05  WS-PRIOR-YEAR-CAM      PIC S9(7)V99  COMP-3.
           05  WS-MAX-INCREASE        PIC S9(7)V99  COMP-3.

       COPY LEASECPY.

       LINKAGE SECTION.

       01  LS-CAMCALC-PARMS.
           05  LS-TENANT-AREA         PIC 9(7)V99  COMP-3.
           05  LS-BLDG-TOTAL          PIC 9(7)V99  COMP-3.
           05  LS-OCCUPIED            PIC 9(7)V99  COMP-3.
           05  LS-EXPENSE-INC         PIC S9(7)V99 COMP-3.
           05  LS-CAP-TYPE            PIC X(2).
               88  LS-CAP-CUMUL       VALUE 'CU'.
               88  LS-CAP-NONCUMUL    VALUE 'NC'.
               88  LS-CAP-NONE        VALUE '  '.
           05  LS-CAP-PCT             PIC 9(3)V99  COMP-3.
           05  LS-PRO-RATA-METH       PIC X(1).
               88  LS-PRORATE-TOTAL   VALUE 'T'.
               88  LS-PRORATE-OCCUP   VALUE 'O'.
           05  LS-RESULT-MO           PIC S9(9)V99 COMP-3.
           05  LS-SHARE-PCT           PIC 9(3)V9(4) COMP-3.
           05  LS-RETURN-CODE         PIC 9(2).

       PROCEDURE DIVISION USING LS-CAMCALC-PARMS.

       0000-MAIN.
           MOVE 0 TO LS-RETURN-CODE
           PERFORM 1000-VALIDATE-INPUT
           IF LS-RETURN-CODE = 0
               PERFORM 2000-COMPUTE-SHARE
               PERFORM 3000-COMPUTE-MONTHLY
               PERFORM 4000-APPLY-CAP
           END-IF
           GOBACK.

       1000-VALIDATE-INPUT.
           IF LS-TENANT-AREA = 0
               MOVE 01 TO LS-RETURN-CODE
           END-IF
           IF LS-BLDG-TOTAL = 0
               MOVE 02 TO LS-RETURN-CODE
           END-IF
           IF LS-OCCUPIED = 0
               MOVE 03 TO LS-RETURN-CODE
           END-IF.

      ******************************************************************
      * COMPUTE PRO-RATA SHARE PERCENTAGE
      * BUG: ALWAYS USES LS-OCCUPIED AS DENOMINATOR REGARDLESS
      *      OF LS-PRO-RATA-METH SETTING. WHEN LEASE SPECIFIES
      *      'T' (TOTAL AREA), SHOULD USE LS-BLDG-TOTAL INSTEAD.
      *      THIS INFLATES TENANT SHARE WHEN BUILDING IS NOT FULL.
      ******************************************************************
       2000-COMPUTE-SHARE.
      *    SHOULD CHECK LS-PRO-RATA-METH HERE BUT DOESNT
           COMPUTE WS-SHARE-DECIMAL ROUNDED =
               LS-TENANT-AREA / LS-OCCUPIED
           MOVE WS-SHARE-DECIMAL TO LS-SHARE-PCT.

      ******************************************************************
      * COMPUTE MONTHLY CAM CHARGE
      * FORMULA: (EXPENSE_INCREASE_PER_SF * TENANT_AREA) / 12
      ******************************************************************
       3000-COMPUTE-MONTHLY.
           COMPUTE WS-ANNUAL-PER-TENANT ROUNDED =
               LS-EXPENSE-INC * LS-TENANT-AREA
           COMPUTE WS-MONTHLY-CHARGE ROUNDED =
               WS-ANNUAL-PER-TENANT / 12
           MOVE WS-MONTHLY-CHARGE TO LS-RESULT-MO.

      ******************************************************************
      * APPLY CAP TO CAM INCREASE
      ******************************************************************
       4000-APPLY-CAP.
           IF LS-CAP-NONE
               GO TO 4000-EXIT
           END-IF

           IF LS-CAP-CUMUL
               PERFORM 4100-CUMULATIVE-CAP
           ELSE
               PERFORM 4200-NONCUMULATIVE-CAP
           END-IF.
       4000-EXIT.
           EXIT.

       4100-CUMULATIVE-CAP.
      *    CUMULATIVE CAP: TOTAL INCREASE FROM BASE YEAR
      *    CANNOT EXCEED CAP% COMPOUNDED ANNUALLY
           COMPUTE WS-CAP-AMOUNT ROUNDED =
               LS-EXPENSE-INC * (LS-CAP-PCT / 100)
           IF LS-RESULT-MO > WS-CAP-AMOUNT
               MOVE WS-CAP-AMOUNT TO LS-RESULT-MO
           END-IF.

       4200-NONCUMULATIVE-CAP.
      *    NON-CUMULATIVE CAP: YEAR-OVER-YEAR INCREASE
      *    CANNOT EXCEED CAP% OF PRIOR YEAR
           COMPUTE WS-MAX-INCREASE ROUNDED =
               WS-PRIOR-YEAR-CAM * (LS-CAP-PCT / 100)
           IF WS-MAX-INCREASE > 0
               IF LS-RESULT-MO > WS-MAX-INCREASE
                   MOVE WS-MAX-INCREASE TO LS-RESULT-MO
               END-IF
           END-IF.
