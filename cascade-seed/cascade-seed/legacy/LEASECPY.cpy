      *****************************************************************
      * LEASECPY  LEASE MASTER RECORD LAYOUT                          *
      * SHARED BY LEASEBIL AND CAMCALC. DO NOT CHANGE WITHOUT          *
      * RECOMPILING BOTH PROGRAMS.                                     *
      * 1994-03  R.OKAFOR   ORIGINAL                                   *
      * 2003-07  T.NGUYEN   ADDED BLDG-OCC-SF (TKT 4471)               *
      *****************************************************************
       01  LEASE-REC.
           05  LR-TENANT-KEY.
               10  LR-TENANT-ID        PIC X(6).
           05  LR-TENANT-KEY-R REDEFINES LR-TENANT-KEY.
               10  LR-PROP-CODE        PIC X(2).
               10  LR-UNIT-NO          PIC X(4).
           05  LR-SQFT                 PIC S9(7)      COMP-3.
           05  LR-RENT-PSF             PIC S9(3)V99   COMP-3.
           05  LR-ESC-PCT              PIC SV9999     COMP-3.
           05  LR-CAP-PCT              PIC SV9999     COMP-3.
           05  LR-BLDG-TOTAL-SF        PIC S9(7)      COMP-3.
           05  LR-BLDG-OCC-SF          PIC S9(7)      COMP-3.
           05  LR-CAM-POOL-MO          PIC S9(7)V99   COMP-3.
           05  LR-MONTHLY-FEE          PIC S9(7)V99   COMP-3.
           05  LR-SLA-PCT              PIC S99        COMP-3.
