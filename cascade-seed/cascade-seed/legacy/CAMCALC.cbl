       IDENTIFICATION DIVISION.
       PROGRAM-ID. CAMCALC.
      *****************************************************************
      * CAMCALC   PRO RATA SHARE OF THE MONTHLY CAM POOL               *
      * CALLED BY LEASEBIL PARAGRAPH 2300-CAM-SHARE                    *
      * 1994-03  R.OKAFOR   ORIGINAL (DENOMINATOR = TOTAL SF)          *
      * 2003-07  T.NGUYEN   DENOMINATOR CHANGED TO OCCUPIED SF         *
      *                     PER PROPERTY MGMT REQUEST (TKT 4471)       *
      *****************************************************************
       DATA DIVISION.
       LINKAGE SECTION.
       COPY LEASECPY.
       01  LK-SHARE                    PIC S9V9(6)    COMP-3.
       PROCEDURE DIVISION USING LEASE-REC LK-SHARE.
       0000-CALC-SHARE.
           IF LR-BLDG-OCC-SF = 0
               MOVE 0 TO LK-SHARE
           ELSE
               COMPUTE LK-SHARE ROUNDED =
                   LR-SQFT / LR-BLDG-OCC-SF
           END-IF
           GOBACK.
